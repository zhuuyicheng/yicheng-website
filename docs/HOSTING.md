# Hosting: Setting Up the Server

Prepares the machine the site runs on: a free Oracle Cloud Arm VM with Docker, reachable at a
free DuckDNS hostname over HTTPS. Done once (again only if the VM is lost); after that the
deploy takes over ([CD.md](CD.md)). Why this setup:
[DESIGN.md §14.5](../DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname).

About an hour. Commands say where they run: **laptop** (WSL) or **VM** (after `ssh portfolio`).

```
your laptop (WSL)                          Oracle Cloud, your home region
ssh portfolio ─────── SSH, port 22 ──────► Ubuntu 24.04 VM: Arm, 1 OCPU, 6 GB
browser ── https://<name>.duckdns.org ───►   │ Oracle's firewall (security list)
                                             │ the VM's firewall (iptables)
                                             └ Docker: Caddy, API ×2, worker, web, Postgres, Redis
DuckDNS:  <name>.duckdns.org  →  the VM's public IP
```

`<public-ip>` is the VM's IP and `<name>` your DuckDNS name. Neither goes into Git: they live
in your SSH config, on DuckDNS, in the server's env file and in GitHub's settings.

---

## Step 1: Oracle Cloud account (browser, 15 min)

[oracle.com/cloud/free](https://www.oracle.com/cloud/free/) → _Start for free_.

- **Home region**: pick the closest. It can never change, and free resources exist only there.
- A card is asked for identity only. When the 30-day trial credit ends, anything not Always
  Free is stopped, not charged. Create only resources labelled **Always Free-eligible**.
- Set up the multi-factor sign-in it asks for.

---

## Step 2: An SSH key for the server (laptop, 2 min)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/portfolio_vm -C "portfolio-vm"   # a passphrase is recommended
cat ~/.ssh/portfolio_vm.pub                                        # Step 3 needs this line
```

The `.pub` half goes on the server; the private half never leaves your laptop. Oracle's
Ubuntu accepts keys only, no passwords. A key used for nothing else can be replaced alone.

---

## Step 3: Create the VM (browser, 10 min)

Console: ☰ → **Compute** → **Instances** → **Create instance**.

| Setting     | Choose                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| Name        | `portfolio`                                                                      |
| Image       | _Change image_ → Ubuntu → **Canonical Ubuntu 24.04** (not "Minimal")             |
| Shape       | _Change shape_ → **Ampere** → `VM.Standard.A1.Flex`, **1** OCPU, **6** GB memory |
| Networking  | New virtual cloud network with a **public** subnet; assign a public IPv4 address |
| SSH keys    | _Paste public key_ → the line from Step 2                                        |
| Boot volume | Default (about 50 GB; 200 GB free in total)                                      |

Check for the **Always Free-eligible** label → **Create**. When it shows **RUNNING**, copy the
**Public IP address**: that is `<public-ip>`.

- **1 OCPU**: 2 was refused ("out of host capacity"), and one core is enough: images are built
  by GitHub, not here. The shape can be edited later (_Edit_ on the instance page).
- **6 GB, not the free 12**: Oracle may reclaim a VM whose CPU, network **and** memory all stay
  under 20 % for a week. 6 GB was sized for an estimated 2 GB; the stack measured about 0.6 GB,
  and Oracle shows about 22 % for the whole VM (2026-11-20): just above the line.
  [Check yourself](#check-yourself), question 3, says what to watch.
- **"Out of capacity"**: try another availability domain (_Placement_), or again later.
  Upgrading to _Pay As You Go_ also helps (Always Free stays free), but mistakes then cost
  money: first add a budget alert (Billing & Cost Management → Budgets, alert at $1).

---

## Step 4: Open the web ports in Oracle's firewall (browser, 5 min)

Instance page → _Primary VNIC_ → the **subnet** → _Security_ → **Default Security List** →
**Add Ingress Rules**, source `0.0.0.0/0`:

| Protocol | Port | For                                                                  |
| -------- | ---- | -------------------------------------------------------------------- |
| TCP      | 80   | Let's Encrypt checks it before issuing a certificate; then redirects |
| TCP      | 443  | HTTPS                                                                |
| UDP      | 443  | HTTP/3 (optional)                                                    |

Keep the existing TCP 22 rule. SSH stays open to everyone because GitHub deploys from changing
IPs; key-only login is what protects it.

---

## Step 5: First login (laptop, then VM, 10 min)

Laptop: add to `~/.ssh/config`, then `ssh portfolio` (answer `yes` to the fingerprint):

```
Host portfolio
  HostName <public-ip>
  User ubuntu
  IdentityFile ~/.ssh/portfolio_vm
```

**See**: `ubuntu@portfolio:~$`. `uname -m` prints `aarch64` (Arm: why images are built for
`linux/arm64`); `nproc` prints the OCPUs (one OCPU is one core).

VM: update, and reboot if asked:

```bash
sudo apt update && sudo apt full-upgrade -y
[ -f /var/run/reboot-required ] && sudo reboot
cat /etc/apt/apt.conf.d/20auto-upgrades      # two lines ending in "1": daily security updates
```

(Missing file: `sudo dpkg-reconfigure -plow unattended-upgrades` → _Yes_.)

---

## Step 6: Open the web ports in the VM's firewall (VM, 5 min)

Oracle's Ubuntu rejects everything but SSH, using rules loaded at boot from
`/etc/iptables/rules.v4`.

```bash
sudo iptables -L INPUT -n --line-numbers    # find the REJECT line's number, N
sudo iptables -I INPUT N -p tcp --dport 80 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT N -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT N -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

**See**: three new `ACCEPT` lines above `REJECT` (rules match top-down; the first match wins).

- **Save now, never after Docker (Step 7)**: `save` writes _all_ current rules to the boot
  file, and Docker's own rules frozen in there would confuse Docker after a reboot. Later
  changes: edit `rules.v4` by hand and reboot.
- **Docker's ports take another path.** A port published by a container skips these `INPUT`
  rules: Docker forwards it through the `FORWARD` chain, where its own rules come first
  (`sudo iptables -L FORWARD -n`). So for containers, Oracle's firewall (Step 4) is the one that
  counts; these rules cover programs run directly on the VM. That is why the stack publishes
  only Caddy's ports: Postgres and Redis publish none.

---

## Step 7: Install Docker (VM, 5 min)

From [Docker's guide for Ubuntu](https://docs.docker.com/engine/install/ubuntu/):

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Use `docker` without `sudo`, and cap log sizes (the default keeps every line forever):

```bash
sudo usermod -aG docker ubuntu
echo '{ "log-driver": "local" }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
exit
```

Log back in, then check: `docker run --rm hello-world` ("Hello from Docker!"),
`docker compose version`, and `docker info --format '{{.LoggingDriver}}'` (`local`).

The `docker` group is as powerful as root: don't add other users to it.

---

## Step 8: A hostname from DuckDNS (browser, 5 min)

1. [duckdns.org](https://www.duckdns.org) → sign in (GitHub works).
2. Type a name under _sub domain_ → **add domain**.
3. Replace _current ip_ with `<public-ip>` (it pre-fills your home IP) → **update ip**.

**See** (laptop, after a minute): `getent hosts <name>.duckdns.org` prints `<public-ip>`. Keep
the DuckDNS _token_ private: it can point your name anywhere. The IP survives reboots.

---

## Step 9: Prove the path with a throwaway HTTPS page (VM, 5 min)

```bash
docker run --rm -p 80:80 -p 443:443 -p 443:443/udp caddy:2 \
  caddy file-server --domain <name>.duckdns.org --root /usr/share/caddy
```

**See**: `certificate obtained successfully` in the log, then `https://<name>.duckdns.org`
shows Caddy's page with a padlock. **Ctrl+C** to stop.

Let's Encrypt connects to port 80 and Caddy answers, proving it controls the name. Run it once
or twice at most: the certificate is thrown away, and the same one is issued only 5 times a
week (the real stack keeps certificates in a volume).

**Done**: next, [CD.md §2](CD.md#2-one-time-setup-about-20-minutes).

---

## Later: `<name>.is-a.dev`

[is-a.dev](https://docs.is-a.dev/) gives free developer subdomains, reviewed by volunteers.
They approve sites that are "at least somewhat complete" (link + screenshot in the pull
request); the site is live, so you can ask now. **Their terms forbid AI-written pull requests**:
write the JSON file and description yourself ([quickstart](https://docs.is-a.dev/quickstart/)).
When `getent hosts <name>.is-a.dev` prints `<public-ip>`, switch `SITE_HOST` (server
`deploy/.env` and GitHub) and deploy.

---

## If the VM is lost

Images are in GitHub's registry, configuration in Git, secrets in your password manager, and
Caddy gets new certificates by itself. Rebuild: Steps 3–7, point DuckDNS (and is-a.dev) at
the new IP, redo [CD.md §2](CD.md#2-one-time-setup-about-20-minutes) with the new `SSH_HOST`
and `SSH_KNOWN_HOSTS`, deploy, then restore the latest backup ([BACKUPS.md](BACKUPS.md)).

---

## Troubleshooting

| Symptom                                              | Cause                                         | Fix                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssh portfolio` hangs                                | Wrong IP, or the TCP 22 rule was removed      | Compare with the instance page; restore the rule (Step 4)                                                                                               |
| `Permission denied (publickey)`                      | Wrong key or user                             | `ssh -v portfolio` shows the key offered; the user is `ubuntu`                                                                                          |
| "Out of capacity"                                    | No free Arm machines right now                | Another availability domain, or later (Step 3)                                                                                                          |
| Browser can't connect at Step 9                      | A port is closed in Oracle's firewall         | Step 4; for programs on the VM also Step 6                                                                                                              |
| Caddy: `challenge failed` / `timeout during connect` | Port 80 unreachable, or DNS not pointing here | `getent hosts <name>.duckdns.org`; Steps 4 and 8                                                                                                        |
| Network or certificate problem?                      | Test without HTTPS (no certificate used up)   | VM: `docker run --rm -p 80:8080 -p 443:8080 caddy:2 caddy respond --listen :8080 OK`; laptop: `curl http://<name>.duckdns.org/` and `…:443/` print `OK` |
| `netfilter-persistent: command not found`            | Package missing                               | `sudo apt install -y iptables-persistent`, redo Step 6                                                                                                  |
| `permission denied … docker.sock`                    | The `docker` group isn't active yet           | Log out and back in (Step 7)                                                                                                                            |

---

## Check yourself

<details><summary>1. Visitors only use HTTPS. Why must port 80 be open?</summary>

Let's Encrypt connects on port 80 to check that the server controls the name (the HTTP-01
challenge). Caddy also uses it to redirect `http://` to `https://`.

</details>

<details><summary>2. Why can Postgres not be reached from the internet, whatever the firewalls say?</summary>

Its container publishes no port. Docker forwards only published ports, and the stack
publishes only Caddy's 80 and 443.

</details>

<details><summary>3. Why 6 GB of memory when 12 GB is free?</summary>

Oracle may reclaim Always Free VMs whose CPU, network and memory all stay under 20 % for a week
([Oracle's rule](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)).
A quiet site keeps CPU and network low (CPU about 5 %; a short spike above 20 % doesn't count,
because the rule looks at the 95th percentile), so memory must stay above 20 %.

6 GB was chosen for an estimated 2 GB. Measured, the stack uses about 0.6 GB (`docker stats`)
and Oracle shows about 22 % for the whole VM, system included (2026-11-20): above the line, by
little. Phase 7's monitoring added about 0.6 GB (2026-11-24: 1.22 GB for the stack), lifting it
further. What to do:

1. Once a week for a while: instance page → **Metrics** → **Memory utilization**, set to the
   last 7 days. Pausing the site doesn't change it: the containers keep running.
2. If it falls under 20 %: **Edit** → shape → 1 OCPU, **3 GB**. The VM restarts once; Docker
   starts the site again by itself. About 2 GB in use (monitoring and system included) is about
   two thirds of 3 GB.

</details>

<details><summary>4. SSH is open to the whole internet. Why is that acceptable?</summary>

Only key logins work, and the private keys never leave your laptop and GitHub. Limiting SSH to
your IP would also lock out GitHub's deploys, which come from changing IPs.

</details>
