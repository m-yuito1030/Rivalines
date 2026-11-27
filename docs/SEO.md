# Search engine optimization (SEO)

Goal: people searching for a browser railway / city-building / multiplayer game can find Rivalines.

## What is in the code
- **Pages to index:** `/` (English landing + login) and `/ja.html` (Japanese landing). Each has a title, a description (60-160 characters), a canonical URL, one `h1`, real text content (what the game is, features, how to start), a screenshot with `alt`, and structured data (JSON-LD `VideoGame`: free, multiplayer).
- **Two languages:** the two pages point to each other with `hreflang` (`en` / `ja` / `x-default` = the English top). The sitemap lists both.
- **The game itself is not indexed:** `/live/` and `/next/` are an application (a login screen and a canvas, no text). nginx sends `X-Robots-Tag: noindex` for them. They are **not** blocked in `robots.txt` on purpose: a page blocked there cannot be read, so its `noindex` would not be seen.
- `public/robots.txt` and `public/sitemap.xml` are served from the root.
- `server/seo.test.ts` checks all of this (CI fails if it is broken).
- Avoid other games' names and trademarks in titles, descriptions and body text (the test checks this).

## What the owner does (cannot be done from the code)
1. **Google Search Console:** add the property `https://rivalines.com/` (DNS verification is the easiest), then submit `https://rivalines.com/sitemap.xml`, and use "URL inspection -> request indexing" for `/` and `/ja.html`.
2. **Bing Webmaster Tools:** import the site from Search Console and submit the same sitemap (this also covers DuckDuckGo and others that use Bing).
3. **Links from other places** (the strongest signal, and the slowest):
   - Show it in game communities: Reddit (r/WebGames, r/IndieGaming), Hacker News "Show HN", Product Hunt, itch.io (a web game page), IndieDB, and in Japanese: X (#個人開発 #ブラウザゲーム) and Zenn / Qiita articles.
   - Put the game link in the "About" box of the GitHub repository.
4. **Name check:** search for "Rivalines" before and after launch to see whether another product uses the same name.
5. **After launch:** in Search Console, watch "Pages" (is `/` indexed?) and "Performance" (which searches bring people). For pages shown as "Crawled - currently not indexed", add real content.

## Notes
- The first indexing usually takes days to weeks. Nothing here guarantees a ranking.
- Do not hide text, stuff keywords, or buy links: that can get the site removed from search results.
- The OGP card (`public/og.png`) is for sharing; see `server/ogp.test.ts`.
