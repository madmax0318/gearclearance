# Runner units

Unit files in `systemd/` are templates. `install.sh` renders them from a private `stash.env` that stays off the repository. Placeholder tokens use `@NAME@` form. Schedules and credential ids are supplied at install time.

`install.sh` runs as the invoking user. It refuses root unless `--system` is passed. Jobs install in dry-run until a later `--live` flag for one job. The script does not name other host services. A self-check denylist, when set, is read from `stash.env`.

`--check` prints the directive checklist, a uid-filtered socket listing, and `NOT ENFORCED (user units)` for address and socket-bind policy that user units cannot apply.

Timers use `AccuracySec=30s` and `Persistent=false`.
