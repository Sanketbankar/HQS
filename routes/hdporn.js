const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const router = express.Router();

// Extract ID from a full URL
function extractIdFromUrl(url) {
    if (!url) return null;
    const parts = url.split("/");
    const lastPart = parts.pop() || parts.pop(); // handle possible trailing slash
    return lastPart || null;
}

// Route handler: /api/top/:page?
const handler = async (req, res) => {
    try {
        const page = parseInt(req.params.page) || 1;
        const url =
            page === 1
                ? "https://hqporner.com/hdporn"
                : `https://hqporner.com/hdporn/${page}`;

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const siteTitle = $("header h1").text().trim();
        const results = {
            currentPage: page,
            availablePages: [],
            totalPages: 1,
            [siteTitle]: [],
        };

        // Collect pagination info
        let maxPage = 1;
        $("ul.actions.pagination li").each((i, li) => {
            const a = $(li).find("a");
            let pageNum;

            if (a.length > 0) {
                // If it's a link
                pageNum = parseInt(a.text().trim());
            } else {
                // If it's the current page (no href)
                pageNum = parseInt($(li).text().trim());
            }

            if (!isNaN(pageNum)) {
                results.availablePages.push(pageNum);
                if (pageNum > maxPage) maxPage = pageNum;
            }
        });

        results.totalPages = maxPage;

        // Validate requested page
        if (!results.availablePages.includes(page) && page !== 1) {
            return res.status(404).json({
                status: "not_found",
                message: `Page ${page} is not available.`,
                availablePages: results.availablePages,
                totalPages: results.totalPages,
            });
        }

        // Scrape video data
        $("div.6u").each((i, div6u) => {
            const sections = $(div6u).find("section");

            sections.each((j, section) => {
                const a = $(section).find("a").first();
                const href = a.attr("href")
                    ? "https://hqporner.com" + a.attr("href")
                    : null;
                const id = href ? '/hdporn/' + extractIdFromUrl(href) : null;

                const rawH3 = $(section).find("div#span-case > h3").text().trim();
                const duration = $(section)
                    .find("div#span-case > span")
                    .text()
                    .trim();

                const h3Text = rawH3.replace(/\w\S*/g, (txt) =>
                    txt.charAt(0).toUpperCase() + txt.slice(1)
                );

                const w403Div = a.find("div.w403px").first();

                let imgSrc = null;
                const imgTag = w403Div.find("img").first();
                const rawSrc = imgTag.attr("src");
                if (rawSrc && rawSrc.startsWith("//")) {
                    imgSrc = "https:" + rawSrc;
                }

                const jpgFromHideList = [];
                w403Div.find("div.hide_noscript").each((l, hideDiv) => {
                    const onmouseover = $(hideDiv).attr("onmouseover") || "";
                    const match = onmouseover.match(/"\/\/([^"]+\.jpg)"/);
                    if (match && match[1]) {
                        jpgFromHideList.push("https://" + match[1]);
                    }
                });

                results[siteTitle].push({
                    title: h3Text,
                    id,
                    duration,
                    link: href,
                    poster: imgSrc,
                    preview: jpgFromHideList,
                });
            });
        });

        // No videos found
        if (results[siteTitle].length === 0) {
            return res.status(404).json({
                status: "not_found",
                message: `No videos found for page ${page}.`,
            });
        }

        res.json({
            status: "success",
            total: results[siteTitle].length,
            currentPage: results.currentPage,
            availablePages: results.availablePages,
            totalPages: results.totalPages,
            data: results,
        });
    } catch (err) {
        console.error("❌ Scraping error:", err.message);
        res.status(500).json({ status: "error", message: err.message });
    }
};

router.get("/", handler); // /api/hdporn
router.get("/:page", handler); // /api/hdporn/2, /api/hdporn/3, etc.

module.exports = router;
