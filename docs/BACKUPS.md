# Backups (Phase 6d)

Every week the server backs up the database, proves the backup restores, and tells you on
Discord. Whenever you like, one command copies the backups home to your desktop
([section 3.4](#34-copying-the-backups-home-whenever-you-like)). Design:
[DESIGN.md §14.6](../DESIGN.md#146-backups-weekly-copied-to-the-owners-desktop).

**Status**: on since 2026-11-22. The server's weekly job runs by itself; the copy to the
desktop is by hand, with no schedule (your choice).

```
server, Sundays 18:00 UTC, by itself             your desktop (WSL), whenever you run it
deploy/backup.sh                                 deploy/pull-backups.sh
  pg_dump → ~/backups/portfolio/*.dump             rsync (read-only key) → ~/portfolio-backups
  test-restore into a scratch database             check every checksum
  keep the newest 4                                keep everything, warn if > 8 days old
  Discord: "Portfolio backup OK: …"                log: ~/portfolio-backups/pull.log
```

---

## 1. What is backed up, and how big it is

- **The Postgres database**, all of it: content, visits (with IP addresses), contact messages,
  the migration history. That is the only data that exists nowhere else.
- **Not Redis**: it holds seconds of work in transit (events waiting to be written,
  notifications waiting to be sent). Content is cached from Postgres and rebuilt by itself.
- **Not the certificates or images**: Caddy gets new certificates by itself, images live in
  the registry, configuration in Git.

**Size**: a backup is compressed. Today it is about 20 KB; each page view adds roughly 50–100
bytes (measured: 44 bytes on test data). At 100 page views a day, a year of visits makes one
backup of 2–4 MB. A year of weekly copies on your desktop stays well under 200 MB.

**Why copy them home**: the server's backups sit on the same VM as the database. They undo a
mistake (a bad migration, deleted rows), but whatever takes the VM takes them too: Oracle
reclaiming or terminating it, the account being closed, a broken disk, someone breaking in.
The copies on your desktop are the ones that survive losing the server; with them you rebuild
it ([section 4](#4-restoring), "From your desktop to a new server").

**The files hold personal data** (IP addresses, names and emails from the contact form). They
are created readable by their owner only; keep the desktop folder private. If your Windows
disk is not encrypted, consider turning on BitLocker (Settings → Privacy & security → Device
encryption).

---

## 2. On the server (after the first deploy)

```bash
ssh portfolio
bash ~/portfolio/deploy/backup.sh       # a first backup by hand: read what it prints
crontab -e                              # then add this line at the end, save and quit:
```

```
0 18 * * 0  /home/ubuntu/portfolio/deploy/backup.sh >>/home/ubuntu/backups/backup.log 2>&1
```

That is cron's "minute hour day month weekday": **18:00 every Sunday**, in the server's time
zone, which is UTC on Oracle's images. Each run:

1. dumps the database to `~/backups/portfolio/portfolio-<date>-<time>Z.dump`, plus a
   `.sha256` checksum (a fingerprint of the file, to detect damage later);
2. **test-restores** it into a scratch database and counts the rows: a backup that was never
   restored is only a hope;
3. keeps the newest 4 (a month); your desktop keeps its own copies of all it has copied;
4. records its time for Prometheus (since Phase 7, DESIGN.md §15.3);
5. posts to Discord, for example
   `Portfolio backup OK: … (20K), test restore found 1234 events and 5 contact messages`, or
   `Portfolio backup FAILED while …`.

**If the Sunday message does not arrive, something is wrong**, even if nothing failed loudly
(the server was down, cron was edited). Check `~/backups/backup.log` on the server. Since
Phase 7 you needn't notice the silence yourself: when no backup has succeeded for 8 days,
Prometheus posts `Firing: BackupStale` to the same channel. It counts from the first backup
after Phase 7 was deployed, so run one by hand then.

---

## 3. On your desktop (WSL), once

### 3.1 A key that can only read the backups

Your server key (`~/.ssh/portfolio_vm`) can do anything on the server. The copy gets its own
key, **without** a passphrase (no question each time), which the server limits to a single
thing: reading the backups folder.

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/portfolio_backups -C portfolio-backups
printf '\ncommand="rrsync -ro /home/ubuntu/backups/portfolio",restrict %s\n' "$(cat ~/.ssh/portfolio_backups.pub)" | ssh portfolio 'cat >> ~/.ssh/authorized_keys'
```

The second command adds one line at the end of the server's `~/.ssh/authorized_keys` (the
keys it accepts) without an editor, so nothing can be mangled by copy and paste. It asks for
your server key's passphrase. The line is the new public key, **prefixed**:

```
command="rrsync -ro /home/ubuntu/backups/portfolio",restrict ssh-ed25519 AAAA… portfolio-backups
```

- `command="rrsync -ro …"`: whatever the key asks for, the server runs only `rrsync`, rsync's
  guard, which allows reading (`-ro`) inside that one folder;
- `restrict`: no terminal, no port forwarding, nothing else.
- The blank line the command writes first is harmless: it makes sure the new key starts on a
  line of its own, even if the file did not end with one.

So if your desktop were ever compromised, this key reveals the backups (which are on that
desktop anyway) but cannot log in, change anything on the server, or delete a backup. And the
server holds no key to your desktop at all: the desktop _pulls_.

Back on your desktop, give the key a name in `~/.ssh/config`:

```
Host portfolio-backups
  HostName <public-ip>
  User ubuntu
  IdentityFile ~/.ssh/portfolio_backups
  IdentitiesOnly yes
```

### 3.2 Where the copies go

The script keeps them in `~/portfolio-backups`. Make that a link to a Windows folder, so the
files are visible in Explorer and survive even if WSL is reinstalled:

```bash
mkdir -p /mnt/c/Users/<you>/Documents/portfolio-backups
ln -s /mnt/c/Users/<you>/Documents/portfolio-backups ~/portfolio-backups
```

(`<you>` is your Windows user name: `ls /mnt/c/Users` shows it.)

### 3.3 First copy by hand

```bash
bash ~/projects/yicheng-website/deploy/pull-backups.sh
```

**See**: the files it copied, then `OK: 1 backups here, newest portfolio-….dump`. If this
computer has never connected to the server, SSH first asks whether to trust it: type `yes`.

### 3.4 Copying the backups home, whenever you like

Nothing runs on a schedule here: copy whenever you think of it. In your Ubuntu (WSL) terminal:

```bash
# Optional: a fresh backup right now instead of last Sunday's (asks for your passphrase)
ssh portfolio 'bash ~/portfolio/deploy/backup.sh'

# Copy every backup this desktop doesn't have yet, then check all of them
bash ~/projects/yicheng-website/deploy/pull-backups.sh

# What you have (the same files are in Documents\portfolio-backups in Windows)
ls -lh ~/portfolio-backups/
```

**See**: the files it copied (none if there is nothing new), then
`OK: 3 backups here, newest portfolio-….dump`. Anything else ends in one of these lines, also
written to `pull.log` in the backups folder:

| Last line                                | Meaning                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `FAILED: the copy did not finish`        | Server unreachable or the key refused ([section 5](#5-when-something-goes-wrong)) |
| `PROBLEM: … does not match its checksum` | A copy here is damaged ([section 5](#5-when-something-goes-wrong))                |
| `PROBLEM: no backup newer than 8 days`   | The server's weekly job has not run ([section 5](#5-when-something-goes-wrong))   |

**How often** is the trade-off of copying by hand:

- The server keeps only its newest 4 backups, about a month. Copy at least once a month and
  your desktop has every weekly backup; copy less often and it misses some weeks in between.
- If the server is ever lost, your newest copy here is what you rebuild from: everything since
  your last copy is gone. Copy again soon after something you would hate to lose, such as a
  contact message.

---

## 4. Restoring

`deploy/restore.sh` replaces the live database with a backup. On the server:

```bash
ssh portfolio
ls -lh ~/backups/portfolio/ # pick one: the names are dates and times in UTC
bash ~/portfolio/deploy/restore.sh ~/backups/portfolio/portfolio-2026-11-22-1800Z.dump
```

1. checks the file against its checksum;
2. loads it into a new database while the site keeps running;
3. stops the API replicas and the worker (for a few seconds, pages say "This page couldn't load");
4. **swaps** names in one transaction: the current database becomes
   `portfolio_before_restore_<time>`, the restored one becomes `portfolio`;
5. applies newer migrations, clears the cached content, starts the services again.

**Nothing is deleted**: the replaced database stays, under its new name, until you drop it.
Visits and messages that arrived after the backup was taken are only in that old one: hidden
from the site, not lost. The next section brings them back.

It asks you to type `restore` first. A damaged file, a wrong answer or a failed load changes
nothing; once the services are stopped, a failure starts them again.

### Bringing back the visits and messages that came after the backup

A restore rewinds everything, including the visits and contact messages that arrived after the
backup. To add those back, copy them over from the old database. Every visit and message has
a unique ID, so the copy skips the ones the restored database already has: only the missing
ones arrive, nothing is doubled, and the restored rows stay as they are (a message you got
back by restoring stays back). Content (profile, projects) is not copied: it comes from
`portfolio.json`.

**Do** (on the server, while the site runs). First the shortcut and the old database's name,
which `restore.sh` printed at the end (`… kept as "portfolio_before_restore_<time>"`):

```bash
C="docker compose -f $HOME/portfolio/deploy/compose.prod.yml"
old=portfolio_before_restore_20261122_1405        # yours: the name restore.sh printed
```

Copy the rows across. It prints nothing when it works:

```bash
$C exec -T -e OLD="$old" postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$OLD" --data-only \
    --table=analytics_events --table=contact_messages --column-inserts --on-conflict-do-nothing |
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --quiet --single-transaction >/dev/null'
```

Then compare the two databases:

```bash
$C exec -T -e OLD="$old" postgres sh -c 'for db in "$OLD" "$POSTGRES_DB"; do
    echo "$db: $(psql -U "$POSTGRES_USER" -d "$db" -At -c "SELECT count(*) FROM analytics_events") visits, $(psql -U "$POSTGRES_USER" -d "$db" -At -c "SELECT count(*) FROM contact_messages") messages"
  done'
```

**See**: `portfolio` has at least as many visits and messages as the old one (more, if the
restore brought back rows that had been deleted).

- **How it works**: `pg_dump --data-only` writes the two tables' rows as `INSERT` statements,
  `--on-conflict-do-nothing` makes each one skip an ID that already exists, and `psql` runs
  them into the live database in one transaction: all of them, or none if anything fails.
- **Safe to repeat**: a second run finds every ID already there and adds nothing.
- **A typo in the name** shows `database "…" does not exist` and copies nothing.
- **Messages copied this way don't go to Discord again**: they were sent when they first
  arrived, and the copy keeps their status (`SENT`).
- **When you're sure**, delete the old database:
  `$C exec -T -e OLD="$old" postgres sh -c 'dropdb -U "$POSTGRES_USER" "$OLD"'`.

Drilled on the desktop's stack (2026-11-22): back up (2 visits, 1 message), add 3 visits and a
message, delete the first message by mistake, restore (2 and 1), copy: 5 visits and both
messages, the deleted one included; a second copy changed nothing.

**From your desktop to a new server** (the VM was lost): rebuild it with
[HOSTING.md](HOSTING.md) and deploy, then send the newest copy up and restore it:

```bash
scp ~/portfolio-backups/portfolio-<date>.dump{,.sha256} portfolio:
ssh portfolio
bash ~/portfolio/deploy/restore.sh ~/portfolio-<date>.dump
```

### Practise on your laptop

The same scripts work against the production stack on your laptop
([PRODUCTION-STACK.md](PRODUCTION-STACK.md)):

```bash
npm run stack:backup                                   # → ~/backups/portfolio
npm run stack:restore -- ~/backups/portfolio/portfolio-<date>.dump
```

Phase 6d's drill did exactly this: back up (5 visits, 1 message), add 3 visits and delete the
message, restore, and count again: 5 and 1, with the changed version kept aside.

---

## 5. When something goes wrong

| Symptom                                                      | What to do                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Discord: `backup FAILED while dumping …`                     | `ssh portfolio`, `docker compose -f ~/portfolio/deploy/compose.prod.yml ps`: is Postgres up? Then run `backup.sh` by hand                  |
| No Sunday message at all, or `Firing: BackupStale`           | `crontab -l` on the server (is the line there?), then `~/backups/backup.log`                                                               |
| `backup OK` ends with `could not be recorded for Prometheus` | The backup is fine. Run `backup.sh` by hand: the error above `done:` says why (Docker, or node-exporter's image missing)                   |
| Copy: `FAILED`, with `Permission denied` above it            | The `authorized_keys` line or `~/.ssh/config` (section 3.1); `ssh -v portfolio-backups` shows why                                          |
| Copy: `PROBLEM: … does not match its checksum`               | That copy is damaged: delete it (and its `.sha256`); the next run copies it again if the server still has it                               |
| Copy: `PROBLEM: no backup newer than 8 days`                 | The server has not made a backup for 8 days: see "No Sunday message"                                                                       |
| `restore.sh` failed after stopping services                  | It restarted them. `psql -l` (inside the Postgres container) lists the databases: the old one is untouched or renamed `…_before_restore_…` |
| A restore went wrong and you want the old one                | Swap back the same way: stop api-1, api-2, worker; rename the databases; start them                                                        |

---

## Check yourself

1. Why does the server test-restore every backup instead of only checking that the file exists?
2. Why does the desktop _pull_ the backups instead of the server _pushing_ them to it?
3. The backup key has no passphrase. What can someone who steals it do?
4. During a restore, where are the visits that arrived after the backup was taken?
5. You haven't copied the backups home for two months. What do you get when you do?

<details>
<summary>Answers</summary>

1. A file can exist and still be useless (cut short, written while something failed, made by a
   version that cannot restore it). Restoring it into a scratch database proves it works, and
   the row counts in the Discord message show what it contains.
2. A push would need a key to your desktop stored on the server, which faces the internet; a
   hacked server could then reach the desktop or delete the copies. Pulling keeps all
   credentials on the desktop, and copies already there can never be changed by the server.
3. Read the backups (and only them), thanks to `command="rrsync -ro …",restrict`. It cannot log
   in, change or delete anything on the server. Remove its line from `authorized_keys` to revoke it.
4. In the old database, renamed `portfolio_before_restore_<time>`. Nothing is deleted until
   you drop it yourself, and "Bringing back the visits and messages that came after the
   backup" (section 4) copies them into the restored one.
5. The four the server still has: the last month, newest included. The weeks before that were
   deleted on the server before you copied them, so your desktop has a gap there. For
   rebuilding the server, the newest backup is the one that counts, and you have it.

</details>
