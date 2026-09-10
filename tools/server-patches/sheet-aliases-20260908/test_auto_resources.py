# Tests for the auto-resource id scheme (checklist §2).
#
# Guards the invariants the 2026-08 rework restored: Chinese ability
# names must NOT degrade to the shared "auto-" id, ids must be stable
# across re-parses, and same-named abilities must stay distinct.
#
# Run: python -m unittest -v test_auto_resources.py

import hashlib
import re
import unittest

from parser import _build_auto_resources, _rid


def _digest(name: str) -> str:
    return hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]


class TestRid(unittest.TestCase):
    def test_chinese_name_keeps_fragment_and_digest(self):
        rid = _rid("狂暴")
        self.assertEqual(rid, f"auto-狂暴-{_digest('狂暴')}")

    def test_ascii_name(self):
        self.assertEqual(_rid("Rage"), f"auto-rage-{_digest('Rage')}")

    def test_mixed_name(self):
        rid = _rid("圣疗 Lay on Hands")
        self.assertTrue(rid.startswith("auto-圣疗-lay-on-hands-"))
        self.assertRegex(rid, r"-[0-9a-f]{8}$")

    def test_symbols_only_name_gets_digest_only(self):
        rid = _rid("★★★")
        self.assertEqual(rid, f"auto-{_digest('★★★')}")

    def test_never_bare_auto(self):
        for name in ["狂暴", "★", "！！", "a", "激励骰"]:
            rid = _rid(name)
            self.assertNotEqual(rid, "auto-")
            self.assertNotEqual(rid, "auto")
            self.assertTrue(len(rid) > len("auto-"))


class TestBuildAutoResources(unittest.TestCase):
    def _specials(self, names):
        return [{"name": n, "max": 3, "current": 3} for n in names]

    def test_duplicate_chinese_names_get_distinct_ids(self):
        out = _build_auto_resources({}, self._specials(["狂暴", "狂暴"]))
        ids = [r["id"] for r in out]
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(set(ids)), 2)
        base = f"auto-狂暴-{_digest('狂暴')}"
        self.assertEqual(ids[0], base)
        self.assertEqual(ids[1], f"{base}-2")

    def test_similar_names_do_not_collide(self):
        out = _build_auto_resources({}, self._specials(["狂暴", "狂暴击"]))
        ids = [r["id"] for r in out]
        self.assertEqual(len(set(ids)), 2)
        for rid in ids:
            self.assertRegex(rid, r"-[0-9a-f]{8}(-\d+)?$")

    def test_reparse_is_deterministic(self):
        spellcasting = {"spell_slots": {"1": {"max": 4, "current": 2}, "3": {"max": 3}}}
        specials = self._specials(["狂暴", "狂暴", "激励骰"])
        a = _build_auto_resources(spellcasting, specials)
        b = _build_auto_resources(spellcasting, specials)
        self.assertEqual(a, b)

    def test_no_degenerate_ids_anywhere(self):
        spellcasting = {"spell_slots": {"1": {"max": 4}}}
        out = _build_auto_resources(spellcasting, self._specials(["狂暴", "★★★", "！"]))
        for r in out:
            self.assertIsInstance(r["id"], str)
            self.assertTrue(r["id"])
            self.assertNotRegex(r["id"], r"^auto-?$")

    def test_spell_slot_id_shape(self):
        out = _build_auto_resources({"spell_slots": {"2": {"max": 3}}}, [])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["id"], f"auto-spell-slot-2-{_digest('spell-slot-2')}")
        self.assertEqual(out[0]["name"], "二环法术位")

    def test_client_mirror_contract(self):
        # The TS mirror (obr-suite/src/modules/resourceTracker/id.ts)
        # must produce these exact ids — if this vector changes, change
        # both sides together.
        self.assertEqual(_rid("狂暴"), "auto-狂暴-" + _digest("狂暴"))
        self.assertTrue(re.fullmatch(r"auto-狂暴-[0-9a-f]{8}", _rid("狂暴")))


if __name__ == "__main__":
    unittest.main()
