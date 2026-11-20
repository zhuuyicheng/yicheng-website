# Backups (Phase 6d)

Every week the server backs up the database, proves the backup restores, and tells you on
Discord. Your desktop then copies it home. Design:
[DESIGN.md §14.6](../DESIGN.md#146-backups-weekly-copied-to-the-owners-desktop).

```
server, Sundays 18:00 UTC                        your desktop (WSL), Mondays 12:00
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
3. keeps the newest 4 (a month); your desktop keeps its own copies of all of them;
4. posts to Discord: `Portfolio backup OK: … (20K), test restore found 1234 events and 5
contact messages`, or `Portfolio backup FAILED while …`.

**If the Sunday message does not arrive, something is wrong**, even if nothing failed loudly
(the server was down, cron was edited). Check `~/backups/backup.log` on the server.

---

## 3. On your desktop (WSL), once

### 3.1 A key that can only read the backups

Your server key (`~/.ssh/portfolio_vm`) has a passphrase, so a scheduled job cannot use it
unattended. The copy job gets its own key, **without** a passphrase, which the server limits
to a single thing: reading the backups folder.

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/portfolio_backups -C portfolio-backups
cat ~/.ssh/portfolio_backups.pub            # one line starting with ssh-ed25519
```

On the server, add that line to `~/.ssh/authorized_keys`, **prefixed** like this (one line):

```bash
ssh portfolio
nano ~/.ssh/authorized_keys     # add at the end:
```

```
command="rrsync -ro /home/ubuntu/backups/portfolio",restrict ssh-ed25519 AAAA… portfolio-backups
```

- `command="rrsync -ro …"`: whatever the key asks for, the server runs only `rrsync`, rsync's
  guard, which allows reading (`-ro`) inside that one folder;
- `restrict`: no terminal, no port forwarding, nothing else.

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

**See**: the files it copied, then `OK: 1 backups here, newest portfolio-….dump`. The first
time, SSH asks whether to trust the server: type `yes`.

### 3.4 Every week, by itself: Windows Task Scheduler

In **Windows PowerShell** (not WSL), paste:

```powershell
$action   = New-ScheduledTaskAction -Execute "wsl.exe" -Argument '-d Ubuntu -- bash -lc "~/projects/yicheng-website/deploy/pull-backups.sh"'
$trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 12:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName "Portfolio backups" -Action $action -Trigger $trigger -Settings $settings
```

- **Mondays 12:00**, after the server's Sunday backup in any time zone.
- `-StartWhenAvailable`: if the computer was off or asleep at that time, the task runs as soon
  as it is back. The server keeps 4 weeks, so even a month away loses nothing that matters.
- A console window flashes briefly while it runs.

Try it at once: Task Scheduler → Task Scheduler Library → **Portfolio backups** → Run. Then
**Last Run Result** says `(0x0)` for success, and `pull.log` in the backups folder has the
details. Other results: `0x1` the copy failed (server unreachable, key refused), `0x2` a file
is damaged, `0x3` no backup newer than 8 days (the server's weekly job is not running).

---

## 4. Restoring

`deploy/restore.sh` replaces the live database with a backup:

```bash
bash deploy/restore.sh ~/backups/portfolio/portfolio-2026-11-22-1800Z.dump
```

1. checks the file against its checksum;
2. loads it into a new database while the site keeps running;
3. stops the API replicas and the worker (a few seconds of "API unreachable");
4. **swaps** names in one transaction: the current database becomes
   `portfolio_before_restore_<time>`, the restored one becomes `portfolio`;
5. applies newer migrations, clears the cached content, starts the services again.

**Nothing is deleted**: the replaced database stays, under its new name, until you drop it.
Visits and messages that arrived after the backup was taken are only in that old one.

It asks you to type `restore` first. A damaged file, a wrong answer or a failed load changes
nothing; once the services are stopped, a failure starts them again.

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

| Symptom                                            | What to do                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Discord: `backup FAILED while dumping …`           | `ssh portfolio`, `docker compose -f ~/portfolio/deploy/compose.prod.yml ps`: is Postgres up? Then run `backup.sh` by hand                  |
| No Sunday message at all                           | `crontab -l` on the server (is the line there?), then `~/backups/backup.log`                                                               |
| Task result `0x1`, `pull.log`: `Permission denied` | The `authorized_keys` line or `~/.ssh/config` (section 3.1); `ssh -v portfolio-backups` shows why                                          |
| Task result `0x2` (checksum)                       | That copy is damaged: delete it (and its `.sha256`); the next run copies it again if the server still has it                               |
| Task result `0x3` (too old)                        | The server has not made a backup for 8 days: see "No Sunday message"                                                                       |
| `restore.sh` failed after stopping services        | It restarted them. `psql -l` (inside the Postgres container) lists the databases: the old one is untouched or renamed `…_before_restore_…` |
| A restore went wrong and you want the old one      | Swap back the same way: stop api-1, api-2, worker; rename the databases; start them                                                        |

---

## Check yourself

1. Why does the server test-restore every backup instead of only checking that the file exists?
2. Why does the desktop _pull_ the backups instead of the server _pushing_ them to it?
3. The backup key has no passphrase. What can someone who steals it do?
4. During a restore, where are the visits that arrived after the backup was taken?
5. Your desktop was off for three weeks. What happens the next time you turn it on?

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
   you drop it yourself.
5. Task Scheduler runs the missed task as soon as it can (`-StartWhenAvailable`), and the
   script copies the three backups made meanwhile (the server keeps four).

</details>
