# Hosting: Setting Up the Server

This guide prepares the machine the site runs on: a free Oracle Cloud Arm VM with Docker,
reachable at a free DuckDNS hostname over HTTPS. You do it once, or again if the VM is ever
lost. From there, Phase 6's deploy workflow takes over
([DESIGN.md §14](../DESIGN.md#14-deployment--continuous-delivery-phase-6)); why this setup was
chosen is in [§14.5](../DESIGN.md#145-hosting-oracle-cloud-free-tier-one-hostname).

Time: about an hour, plus waiting if Oracle has no free capacity at first.

Each step has the same shape as the guided tour: **Do**, **See**, **Why**. Commands say where
they run: **laptop** (your WSL terminal) or **VM** (after `ssh portfolio`, Step 5).

---

## What you'll end up with

```
your laptop (WSL)                          Oracle Cloud, your home region
─────────────────                          ───────────────────────────────────────────
ssh portfolio ─────── SSH, port 22 ──────► Ubuntu 24.04 VM: Arm, 2 OCPUs, 6 GB
                                             │ 1. Oracle's firewall (security list)
browser ── https://<name>.duckdns.org ───►   │ 2. the VM's own firewall (iptables)
                                             └ Docker ─► later: Caddy, API ×2, worker,
                                                                web, Postgres, Redis
DuckDNS:  <name>.duckdns.org  →  the VM's public IP
```

Placeholders: `<public-ip>` is the VM's public IP address, `<name>` the DuckDNS name you pick.
Neither goes into Git (DESIGN.md §14.5): they live in your SSH config, on DuckDNS, and later in
the server's env file and GitHub settings.

---

## Step 1: Create the Oracle Cloud account (15 min)

**Do** (browser): go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) →
_Start for free_, and fill in the form.

- **Home region: choose carefully.** It can never be changed, and Always Free resources exist
  only in the home region. Pick the region closest to you and your visitors.
- Oracle asks for a card to verify your identity (you may see a small verification hold that
  is released). A Free Tier account is not billed: when the 30-day trial credit ends, anything
  that isn't Always Free is stopped, not charged.
- Set up the multi-factor sign-in it asks for.

**See**: the Oracle Cloud Console home page, with a trial credit valid for 30 days.

**Why**: one rule keeps this free forever: only create resources labelled **Always
Free-eligible**. Then nothing changes when the trial credit runs out.

---

## Step 2: Make an SSH key for the server (laptop, 2 min)

**Do**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/portfolio_vm -C "portfolio-vm"   # a passphrase is recommended
cat ~/.ssh/portfolio_vm.pub
```

**See**: one line starting with `ssh-ed25519`. Keep this terminal open; Step 3 needs that line.

**Why**: an SSH key is a pair. The public half (`.pub`) goes on the server; the private half
never leaves your laptop. Oracle's Ubuntu images accept key logins only, no passwords, so the
private key is the only way in. A key used for nothing else can be replaced without touching
your other keys (GitHub, work). GitHub Actions will get its own key later, so either can be
revoked without the other.

---

## Step 3: Create the VM (10 min)

**Do** (Console): ☰ menu → **Compute** → **Instances** → **Create instance**.

| Setting     | Choose                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| Name        | `portfolio`                                                                               |
| Image       | _Change image_ → Ubuntu → **Canonical Ubuntu 24.04** (the standard one, not "Minimal")    |
| Shape       | _Change shape_ → **Ampere** → `VM.Standard.A1.Flex`, **2** OCPUs, **6** GB memory         |
| Networking  | Create a new virtual cloud network with a **public** subnet; assign a public IPv4 address |
| SSH keys    | _Paste public key_ → the `ssh-ed25519 …` line from Step 2                                 |
| Boot volume | Leave the default (about 50 GB; the free allowance is 200 GB in total)                    |

Check that the shape shows the **Always Free-eligible** label, then **Create**.

**See**: the state goes from PROVISIONING to **RUNNING** within a couple of minutes. On the
instance page, copy the **Public IP address**: that is `<public-ip>`.

**Why 6 GB and not the free 12 GB?** Oracle may reclaim an Always Free VM that looks idle: CPU
(95th percentile), network **and** memory use all below 20 % for 7 days. A quiet portfolio
uses little CPU and network, so memory decides. The stack needs roughly 2 GB, which is a fair
share of 6 GB but under 20 % of 12 GB. 6 GB still leaves plenty of headroom, and the shape can
be changed later (_Edit_ on the instance page). We'll measure real usage with `docker stats`
once the stack runs.

**If it says "Out of capacity" / "Out of host capacity"**: Oracle has no free Arm machines
left there right now. Oracle's own advice: pick another availability domain under
_Placement_ (if your region has several), or wait and try again later, since capacity frees up
over hours or days. Upgrading the account to _Pay As You Go_ also helps; Always Free resources
stay free on it, but a mistake could then cost money. If you upgrade, first create a budget
with an email alert (Billing & Cost Management → Budgets, alert at $1).

---

## Step 4: Open the web ports in Oracle's firewall (5 min)

Two firewalls stand between the internet and the server. This step opens the outer one,
Oracle's network firewall (the **security list**); Step 6 opens the one inside the VM. A port
must be open in **both**.

**Do** (Console): instance page → _Primary VNIC_ → click the **subnet** → _Security_ → the
**Default Security List** → **Add Ingress Rules**. Add three rules, each with source CIDR
`0.0.0.0/0` (anyone):

| IP protocol | Destination port | What it's for                                                                  |
| ----------- | ---------------- | ------------------------------------------------------------------------------ |
| TCP         | 80               | HTTP: Let's Encrypt checks it before issuing a certificate; Caddy redirects it |
| TCP         | 443              | HTTPS                                                                          |
| UDP         | 443              | HTTP/3 (optional: browsers fall back to TCP without it)                        |

Leave the existing **TCP 22** (SSH) rule as it is.

**Why not limit SSH to your own IP?** The deploy workflow will log in over SSH from GitHub's
machines, whose IPs change all the time. What protects port 22 is key-only login: bots try it
all day (you'll see them in `/var/log/auth.log`) and get nowhere without the private key.

---

## Step 5: First login (laptop, then VM, 10 min)

**Do** (laptop): add this to `~/.ssh/config` (create the file if it doesn't exist), with your
IP:

```
Host portfolio
  HostName <public-ip>
  User ubuntu
  IdentityFile ~/.ssh/portfolio_vm
```

Then connect, and type `yes` when asked whether to trust the server's fingerprint:

```bash
ssh portfolio
```

**See**: a prompt like `ubuntu@portfolio:~$`. Try `uname -m`: it prints `aarch64`, which is Arm,
the reason our images are built for `linux/arm64`.

**Do** (VM): bring the system up to date, and reboot if an update asks for it:

```bash
sudo apt update && sudo apt full-upgrade -y
[ -f /var/run/reboot-required ] && sudo reboot
```

After a reboot, wait about 30 seconds and `ssh portfolio` again. Then check that security
updates install themselves daily:

```bash
cat /etc/apt/apt.conf.d/20auto-upgrades
```

**See**: two lines, both ending in `"1";`. If the file is missing, run
`sudo dpkg-reconfigure -plow unattended-upgrades` and answer _Yes_.

**Why**: `~/.ssh/config` gives the server a short name, so neither you nor later commands need
to remember the IP or the key path. Automatic security updates matter because this machine is
on the internet around the clock.

---

## Step 6: Open the web ports in the VM's own firewall (VM, 5 min)

Oracle's Ubuntu images ship with a strict firewall: rules loaded at every boot from
`/etc/iptables/rules.v4` that reject everything except SSH.

**Do**:

```bash
sudo iptables -L INPUT -n --line-numbers
```

**See** something like this (numbers may differ):

```
num  target  prot opt source     destination
1    ACCEPT  all  --  0.0.0.0/0  0.0.0.0/0    state RELATED,ESTABLISHED
2    ACCEPT  icmp --  0.0.0.0/0  0.0.0.0/0
3    ACCEPT  all  --  0.0.0.0/0  0.0.0.0/0
4    ACCEPT  udp  --  0.0.0.0/0  0.0.0.0/0    udp spt:123
5    ACCEPT  tcp  --  0.0.0.0/0  0.0.0.0/0    state NEW tcp dpt:22
6    REJECT  all  --  0.0.0.0/0  0.0.0.0/0    reject-with icmp-host-prohibited
```

Rules are checked from the top and the first match wins, so new `ACCEPT` rules must go
**above** the `REJECT`. Replace `N` with the `REJECT` line's number (6 above):

```bash
sudo iptables -I INPUT N -p tcp --dport 80 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT N -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT N -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

List the rules again: three new `ACCEPT` lines now sit above `REJECT`.

**Why save now, before Docker?** `netfilter-persistent save` writes **all** current rules into
`/etc/iptables/rules.v4`, the file loaded at boot. Docker adds rules of its own every time it
starts; saving after Docker is installed would freeze copies of them into that file and
confuse Docker after the next reboot. So save here, and never run `netfilter-persistent save`
after Step 7. To change these rules later, edit `/etc/iptables/rules.v4` by hand and reboot
(Docker adds its own rules back when it starts).

---

## Step 7: Install Docker (VM, 5 min)

**Do**: install Docker's official packages, as in
[Docker's guide for Ubuntu](https://docs.docker.com/engine/install/ubuntu/):

```bash
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Let your user run `docker` without `sudo`, and keep container logs from growing forever:

```bash
sudo usermod -aG docker ubuntu
echo '{ "log-driver": "local" }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
exit
```

Log back in (`ssh portfolio`) so the new group applies, then check:

```bash
docker run --rm hello-world
docker compose version
docker info --format '{{.LoggingDriver}}'
```

**See**: "Hello from Docker!", a Compose version (v2 or later), and `local`.

**Why**:

- Docker picks the `arm64` variant of an image by itself; `hello-world` proves it works.
- Docker's default log driver keeps every line forever, so after a few months logs could fill
  the disk. The `local` driver keeps at most 100 MB per container (5 files of 20 MB).
- Being in the `docker` group is as powerful as being root: anyone in it can start a container
  that mounts the whole disk. That's fine for your own login; just don't add other users.

---

## Step 8: Get your hostname from DuckDNS (browser, 5 min)

**Do**:

1. Go to [duckdns.org](https://www.duckdns.org) and sign in (GitHub works).
2. Type the name you want under _sub domain_ → **add domain**.
3. **Replace the _current ip_ with `<public-ip>`**, then click **update ip**. DuckDNS fills in
   the IP of the computer you're browsing from (your home connection), not the server's.

**See** (laptop), after a minute:

```bash
getent hosts <name>.duckdns.org
```

prints `<public-ip>  <name>.duckdns.org`.

**Why**: DNS turns the name into the server's address. Keep the _token_ shown on the DuckDNS
page private: anyone who has it can point your name somewhere else. Rebooting keeps the VM's
IP, so there's nothing to automate; only deleting the VM loses the IP.

---

## Step 9: Prove the whole path with a throwaway HTTPS page (VM, 5 min)

Before any of our code is involved, check every link in the chain at once: DNS → Oracle's
firewall → the VM's firewall → Docker → a real certificate.

**Do**:

```bash
docker run --rm -p 80:80 -p 443:443 -p 443:443/udp caddy:2 \
  caddy file-server --domain <name>.duckdns.org --root /usr/share/caddy
```

**See**: within about 30 seconds the log shows `certificate obtained successfully`. Open
`https://<name>.duckdns.org` in your browser: Caddy's welcome page, with a padlock. Press
**Ctrl+C** on the VM to stop it.

**Why it works**: `--domain` tells Caddy which name it serves, and Caddy then gets a
certificate on its own. Let's Encrypt connects to `http://<name>.duckdns.org/.well-known/…` on
**port 80** and Caddy answers, proving it controls that name. That's why port 80 must be open
even though visitors only use HTTPS.

Run it once or twice at most: this container throws its certificate away when it stops, and
Let's Encrypt issues the same certificate only 5 times a week. The real setup keeps
certificates in a Docker volume.

**Done**: the server is ready. Nothing else runs on it until the deploy workflow arrives.

---

## Later: switching to `<name>.is-a.dev` (after the first deploy)

[is-a.dev](https://docs.is-a.dev/) gives developers free subdomains, reviewed by volunteers.
Their rules decide the timing:

- They approve sites that are "at least somewhat complete", with a link and a screenshot in
  the pull request. So ask once the site is live on DuckDNS.
- **Their terms forbid using AI tools to write the pull request** (they name Claude Code) and
  may block authors who do. Write the JSON file and the PR description yourself, following
  [their quickstart](https://docs.is-a.dev/quickstart/).
- Every later change, such as a new IP, is another reviewed pull request: one more reason to
  keep this VM rather than recreate it.

Once it's merged and `getent hosts <name>.is-a.dev` prints `<public-ip>`, switching is a
configuration change (`SITE_HOST`, DESIGN.md §14.5), not a rebuild.

---

## If the VM is ever lost

Reclaimed by Oracle or deleted by mistake, the VM is replaceable (DESIGN.md §14.5): images are
in GitHub's registry, configuration in Git, secrets in GitHub and your password manager, and
Caddy fetches new certificates by itself. To rebuild: Steps 3 to 7 here, point DuckDNS (and
is-a.dev, by pull request) at the new IP, deploy, then restore the latest database backup.

---

## Troubleshooting

| Symptom                                                   | Likely cause                                                      | Fix                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ssh portfolio` hangs, then times out                     | Wrong IP in `~/.ssh/config`, or the TCP 22 rule was removed       | Compare with the instance page; restore the rule (Step 4)               |
| `Permission denied (publickey)`                           | Wrong key or user                                                 | `ssh -v portfolio` shows which key it offers; the user must be `ubuntu` |
| "Out of capacity" when creating the VM                    | No free Arm machines right now                                    | Step 3: another availability domain, or try again later                 |
| Browser can't connect at Step 9                           | A port is closed in one of the two firewalls                      | Re-check Step 4 and Step 6 (`sudo iptables -L INPUT -n --line-numbers`) |
| Caddy log: `challenge failed` or `timeout during connect` | Let's Encrypt can't reach port 80, or DNS isn't pointing here yet | `getent hosts <name>.duckdns.org` on the laptop; Steps 4, 6 and 8       |
| `netfilter-persistent: command not found`                 | The package is missing                                            | `sudo apt install -y iptables-persistent`, then repeat Step 6           |
| `permission denied … docker.sock`                         | The `docker` group isn't active in this login yet                 | Log out and back in (Step 7)                                            |

---

## Check yourself

<details><summary>1. Why do the web ports have to be opened in two places?</summary>

There are two separate firewalls. Oracle's security list filters traffic in Oracle's network,
before it reaches the VM (Step 4); iptables filters it again inside the VM (Step 6). A packet
must get past both, so a port closed in either one looks exactly like a dead server.

</details>

<details><summary>2. Visitors only ever use HTTPS. Why must port 80 be open?</summary>

To get a certificate, Let's Encrypt connects to the hostname on port 80 and asks for a token
that only the real server can produce (the HTTP-01 challenge). Caddy also uses port 80 to
redirect `http://` visitors to `https://`.

</details>

<details><summary>3. Why give the VM 6 GB of memory when 12 GB is free?</summary>

Oracle reclaims Always Free VMs that look idle: CPU, network and memory all under 20 % for a
week. A quiet portfolio barely uses CPU or network, so memory decides. Our ~2 GB stack is a
real share of 6 GB, but under 20 % of 12 GB.

</details>

<details><summary>4. Why run <code>netfilter-persistent save</code> before installing Docker, and never after?</summary>

`save` writes every current rule into the file loaded at boot. After Docker is installed, that
would include Docker's own rules, which Docker recreates every time it starts. Loading stale
copies at boot would conflict with them.

</details>

<details><summary>5. Why does the is-a.dev request wait until the site is live?</summary>

Their reviewers approve only sites that are already reasonably complete, with a link and a
screenshot in the pull request. DuckDNS needs no review, so the site goes live there first.

</details>

<details><summary>6. SSH is open to the whole internet. Why is that acceptable here?</summary>

The server accepts key logins only, so without the private key (which never leaves your
laptop) a login attempt fails. Limiting SSH to your own IP would also lock out GitHub Actions,
which deploys from changing IPs.

</details>
