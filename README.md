# AetherStar website

A static site with no build step, hosted on GitHub Pages (see below). Preview it locally:

```bash
python -m http.server 8765
```

| Page | What's on it |
| --- | --- |
| `index.html` | What AetherStar is, what you need, screenshots, highlights, where it comes from |
| `features.html` | How a night goes, scoring and ranks, modes, second screen, setup |
| `songs.html` | The UltraStar format, USDB, USDB Syncer, adding a folder, supported tags |
| `download.html` | Downloads, requirements, install notes, what's new, source code, FAQ |
| `legal.html` | Privacy notice in English and German, credits and trademarks |

Scripts: `js/site.js` (headline, walkthrough, rank ladder) and `js/lightbox.js`
(screenshot viewer). Fonts are self-hosted in `fonts/`.

## Hosting: GitHub Pages at aetherstar.dev

The domain is registered at IONOS, but the site is served by GitHub Pages. GitHub gets a
free Let's Encrypt certificate for the domain and renews it on its own, so no IONOS SSL
certificate is needed. The `CNAME` file tells GitHub Pages to serve the site at
`aetherstar.dev`.

1. Push this folder to a public GitHub repo and, in the repo's **Settings › Pages**, set
   the source to the `main` branch, root folder.
2. In the IONOS Control Panel, open **Domains & SSL** › `aetherstar.dev` › **DNS**. If the
   domain is still connected to IONOS webspace, change its usage to point elsewhere first,
   or IONOS won't let you edit the A record. Delete the existing A record
   (`217.160.0.168`) and any AAAA records for `@`, then add:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `d3fxgit.github.io` |

3. Back in **Settings › Pages**, set the custom domain to `aetherstar.dev`. Once the DNS
   check passes and the certificate is issued (usually minutes, up to 24 hours), tick
   **Enforce HTTPS**. `.dev` domains only work over HTTPS.
4. To stop anyone else claiming the domain on GitHub Pages, verify it under your GitHub
   account's **Settings › Pages**.

GitHub Pages serves `404.html` for missing pages on its own.

## Before it goes live

- **Stay anonymous and non-commercial.** The site has no Impressum and names only the
  alias D3FXgit. That relies on it staying a private hobby project: no ads, no donation
  or sponsor links, nothing for sale. If that changes, add an Impressum.
- **Host it on GitHub Pages.** The privacy notice says the site is hosted there. If you
  use another host, update the Hosting paragraphs in `legal.html`.
- **Check the domain's WHOIS privacy.** Make sure your registrar hides your name and
  address in the public WHOIS/RDAP record for aetherstar.dev, or the domain gives you away.
- **Make the GitHub repo public and publish a release.** All download buttons point to
  `https://github.com/D3FXgit/Aetherstar/releases/latest`. GitHub Pages can't host the
  installers themselves (100 MB file limit), so releases are the right place.

## Screenshots

Every image in `img/` is a real capture of AetherStar 1.1 at 2560x1440, saved as WebP at
1280 and 2560 px. They use a demo library of public-domain folk songs with covers made for
this site, demo player names, and one CC0 stage photo from Wikimedia Commons as the song
background ("Rock concert in intense light"). No commercial music, cover art or video
appears in them.
