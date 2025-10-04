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

// Scraper function (used for /top, /top/month, /top/week)
const scrapeTop = async (req, res, type = "top") => {
    try {
        const page = parseInt(req.params.page) || 1;

        // Build URL
        let basePath = "https://hqporner.com/top";
        if (type === "month") basePath = "https://hqporner.com/top/month";
        if (type === "week") basePath = "https://hqporner.com/top/week";

        const url = page === 1 ? basePath : `${basePath}/${page}`;

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const siteTitle = $("header h1").text().trim();
        const results = {
            currentPage: page,
            availablePages: [],
            totalPages: 1,
            [siteTitle]: [],
        };

        // Pagination
        let maxPage = 1;
        $("ul.actions.pagination li").each((i, li) => {
            const a = $(li).find("a");
            let pageNum;

            if (a.length > 0) {
                pageNum = parseInt(a.text().trim());
            } else {
                pageNum = parseInt($(li).text().trim());
            }

            if (!isNaN(pageNum)) {
                results.availablePages.push(pageNum);
                if (pageNum > maxPage) maxPage = pageNum;
            }
        });
        results.totalPages = maxPage;

        if (!results.availablePages.includes(page) && page !== 1) {
            return res.status(404).json({
                status: "not_found",
                message: `Page ${page} is not available.`,
                availablePages: results.availablePages,
                totalPages: results.totalPages,
            });
        }

        // Scrape videos
        $("div.6u").each((i, div6u) => {
            $(div6u)
                .find("section")
                .each((j, section) => {
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

// Routes
router.get("/", (req, res) => scrapeTop(req, res, "top"));         // /api/top
router.get("/:page", (req, res) => scrapeTop(req, res, "top"));   // /api/top/2

router.get("/month", (req, res) => scrapeTop(req, res, "month")); // /api/top/month
router.get("/month/:page", (req, res) => scrapeTop(req, res, "month")); 

router.get("/week", (req, res) => scrapeTop(req, res, "week"));   // /api/top/week
router.get("/week/:page", (req, res) => scrapeTop(req, res, "week"));

module.exports = router;
