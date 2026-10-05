#!/bin/sh
# REVIEW TEMPLATE ONLY. Requires explicit approval for this persistent account/grant.
# Generates no key. Never run from GitHub Actions or before user approval.
set -eu
test "${1-}" = '--confirmed-account-and-preflight-grant' || { echo 'Explicit account/preflight approval required'; exit 1; }
test "$(id -u)" = 0 || { echo 'An administrator must install the fixed entry point'; exit 1; }
if getent passwd obr-deploy >/dev/null; then
  echo 'Existing obr-deploy account: stop and review instead of replacing credentials'; exit 1
fi
test -x /usr/bin/python3
test -x /usr/bin/openssl
test -f /run/lock/obr-static-release.lock
test ! -e /etc/sudoers.d/obr-deploy-preflight
test ! -e /usr/local/libexec/obr-deploy
test ! -e /var/lib/obr-deploy
# The cloud's existing AuthorizedKeysCommand can supply unrestricted alternate
# keys. Require an approved/reloaded Match User policy BEFORE creating the account.
/usr/sbin/sshd -T -C user=obr-deploy,host=obr.dnd.center,addr=127.0.0.1 | /usr/bin/python3 -I -B -c 'import sys; data=dict(line.rstrip().split(" ",1) for line in sys.stdin); required={"authenticationmethods":"publickey","passwordauthentication":"no","kbdinteractiveauthentication":"no","authorizedkeyscommand":"none","authorizedkeysfile":"/var/lib/obr-deploy/.ssh/authorized_keys","forcecommand":"/usr/bin/sudo -n /usr/bin/python3 -I -B /usr/local/libexec/obr-deploy/server_preflight.py","disableforwarding":"yes","permittty":"no","permittunnel":"no","permituserrc":"no","permituserenvironment":"no"}; sys.exit(0 if all(data.get(k)==v for k,v in required.items()) else "Approved SSH isolation policy must be active first")'
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test -f "$script_dir/server_preflight.py"
test -f "$script_dir/obr-deploy-preflight.sudoers"
visudo -cf "$script_dir/obr-deploy-preflight.sudoers"
useradd --system --no-create-home --home-dir /var/lib/obr-deploy --shell /bin/sh obr-deploy
usermod -L obr-deploy
install -d -o root -g root -m 0755 /var/lib/obr-deploy /var/lib/obr-deploy/.ssh /usr/local/libexec/obr-deploy
install -o root -g root -m 0644 "$script_dir/server_preflight.py" /usr/local/libexec/obr-deploy/server_preflight.py
install -o root -g root -m 0440 "$script_dir/obr-deploy-preflight.sudoers" /etc/sudoers.d/obr-deploy-preflight
install -o root -g root -m 0644 /dev/null /var/lib/obr-deploy/.ssh/authorized_keys
visudo -cf /etc/sudoers.d/obr-deploy-preflight
echo 'Fixed read-only grant installed. No key was created or installed; no production write permission exists.'
echo 'User must submit exactly one restricted public key through the server secure platform.'
