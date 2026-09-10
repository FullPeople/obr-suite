# Character feature display

Adds the missing fighting styles and special abilities to the legacy static
character page. These entries initially show their complete authored description
and can be collapsed. Text remains escaped by the existing Jinja environment.
The main name also falls back to `character_name` when no display alias exists.
Old cards without the new feature lists retain their existing sections.

The original template matches the live service fingerprint recorded in the
manifest. The separate parser patches are not needed to render existing JSON
containing these fields. Only the template changes; no service code, CSS or
JavaScript is replaced.

```text
python -B -X utf8 prepare_renderer.py --source <existing-renderer-directory> --output <new-renderer-directory>
```

The source and replacement hashes are checked before a new output directory is
created. Existing or overlapping output directories are rejected. This prepares
a reviewable copy, not an installation. Existing hosted HTML needs to be rendered
again after a future deployment; the patch does not update stored pages itself.

Scope and browser evidence: `docs/research/character-feature-display-20260910.md`.
Suite's compact info page receives its corresponding fix in normal app source.
