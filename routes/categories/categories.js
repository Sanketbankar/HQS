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

// Route handler: /api/categories
const handler = async (req, res) => {
    try {
        const url = "https://hqporner.com/categories"; // no pagination
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

        const siteTitle = $("header h1").text().trim();
        const results = {
            [siteTitle]: [],
        };

        // Target: #main-wrapper > div.3u > section
        $("#main-wrapper div.3u").each((i, div3u) => {
            const section = $(div3u).find("section").first();
            const a = section.find("a").first();

            const href = a.attr("href")
                ? "https://hqporner.com" + a.attr("href")
                : null;

            const id = href ? '/category/' + extractIdFromUrl(href) : null; 

            const imgTag = a.find("img").first();
            let poster = null;
            if (imgTag.length > 0) {
                const rawSrc = imgTag.attr("src");
                if (rawSrc) {
                    poster = rawSrc.startsWith("//")
                        ? "https:" + rawSrc
                        : rawSrc;
                }
            }

            const title = section.find("h3").text().trim();

            if (href && poster && title) {
                results[siteTitle].push({
                    title,
                    id,
                    link: href,
                    poster,
                });
            }
        });

        if (results[siteTitle].length === 0) {
            return res.status(404).json({
                status: "not_found",
                message: "No categories found.",
            });
        }

        res.json({
            status: "success",
            total: results[siteTitle].length,
            data: results,
        });
    } catch (err) {
        console.error("❌ Scraping error:", err.message);
        res.status(500).json({ status: "error", message: err.message });
    }
};

router.get("/", handler);

module.exports = router;
