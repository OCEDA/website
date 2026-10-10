"""Tiny admin CLI.
  python -m app.manage create-user dr.x@clinic.org 's3cret!' "Dr. X"
  python -m app.manage create-device dr.x@clinic.org "Pi Zero W #2"     # prints the device token
"""
import secrets
import sys

from . import auth, db


def main(argv):
    db.init()
    if len(argv) == 5 and argv[1] == "create-user":
        auth.create_user(argv[2], argv[3], argv[4])
        print("created", argv[2])
    elif len(argv) == 4 and argv[1] == "create-device":
        with db.conn() as c:
            u = c.execute("SELECT id FROM users WHERE email=?", (argv[2].lower(),)).fetchone()
        if not u:
            sys.exit("no such user")
        token = secrets.token_urlsafe(24)
        auth.create_device(u["id"], argv[3], token)
        print("device token (shown once):", token)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
