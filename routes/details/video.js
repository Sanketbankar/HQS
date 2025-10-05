const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const chromium = require("chrome-aws-lambda");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const router = express.Router();
const BASE = "https://hqporner.com/hdporn";

function extractIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split("/");
  const lastPart = parts.pop() || parts.pop();
  return lastPart || null;
}

/**
 * Extract video sources from a Puppeteer context (page or iframe)
 */
async function extractSources(context, selector) {
  await context.waitForSelector(selector, { visible: true, timeout: 10000 });
  return await context.evaluate((sel) => {
    const sourceArray = [];
    const videoContainer = document.querySelector(sel);
    const videoElement = videoContainer ? videoContainer.querySelector("video") : null;

    if (videoElement) {
      videoElement.querySelectorAll("source").forEach((srcEl) => {
        const title = srcEl.getAttribute("title") || "";
        const src = srcEl.src || srcEl.getAttribute("src") || "";
        if (src) sourceArray.push({ title, src });
      });
    }
    return sourceArray;
  }, selector);
}

router.get(/\/(.*)/, async (req, res) => {
  let browser;
  let page;

  try {
    const videoPath = req.params[0];
    if (!videoPath)
      return res.status(400).json({ status: "error", message: "Missing video path" });

    const videoUrl = `${BASE}/${videoPath}`;
    console.log(`🎬 Fetching video: ${videoUrl}`);

    // ==========================================================
    // STEP 1: Launch Puppeteer (chrome-aws-lambda compatible)
    // ==========================================================
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: await chromium.executablePath || undefined,
      headless: true,
    });

    page = await browser.newPage();
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    // ==========================================================
    // STEP 2: Extract dynamic video sources
    // ==========================================================
    const containerSelector = "div#jwd";
    let sources = [];

    try {
      sources = await extractSources(page, containerSelector);
      console.log(`✅ Found sources in main frame.`);
    } catch (e) {
      console.log(`❌ Main frame failed. Checking iframe...`);
      const iframeElement = await page.$("iframe");
      if (iframeElement) {
        const frame = await iframeElement.contentFrame();
        if (frame) {
          sources = await extractSources(frame, containerSelector);
          console.log(`✅ Found sources inside iframe.`);
        } else {
          console.log(`⚠️ Could not access iframe content (cross-origin).`);
        }
      }
    }

    // ==========================================================
    // STEP 3: Load HTML for static scraping with Cheerio
    // ==========================================================
    const htmlContent = await page.content();
    const $ = cheerio.load(htmlContent);

    // 🎬 Video Details
    const videoTitle = $("header h1").text().trim();
    const metaUl = $("div.12u header ul");
    let uploadDate = null,
      duration = null,
      cast = [];

    if (metaUl.length) {
      const lis = metaUl.find("li");
      uploadDate = lis.eq(0).text().trim() || null;
      duration = lis.eq(1).text().trim() || null;

      lis.eq(2)
        .find("a")
        .each((_, aEl) => {
          const $a = $(aEl);
          const href = $a.attr("href") ? "https://hqporner.com" + $a.attr("href") : null;
          const id = extractIdFromUrl(href);
          cast.push({ id, name: $a.text().trim(), href });
        });
    }

    const videoDetails = { videoTitle, uploadDate, duration, cast };

    // 📂 Categories
    const categories = [];
    const pageContent = $("div.box.page-content");
    const sections = pageContent.find("section");
    if (sections.length >= 3) {
      const thirdSection = sections.eq(2);
      const sectionTitle = thirdSection.find("h3").text().trim();
      const categoryLinks = [];
      thirdSection.find("p a").each((_, aEl) => {
        const $a = $(aEl);
        const href = $a.attr("href") ? "https://hqporner.com" + $a.attr("href") : null;
        const id = extractIdFromUrl(href);
        categoryLinks.push({ id, text: $a.text().trim(), href });
      });
      categories.push({ sectionTitle, links: categoryLinks });
    }

    // 🧩 Sidebar Sections
    const sidebarSections = [];
    $("div.sidebar section").each((_, section) => {
      const sectionTitle = $(section).find("h2").text().trim();
      const items = [];
      $(section)
        .find("ul li")
        .each((_, li) => {
          const h3 = $(li).find("h3");
          if (!h3.length) return;
          const href = $(li).find("a").attr("href")
            ? "https://hqporner.com" + $(li).find("a").attr("href")
            : null;
          const id = extractIdFromUrl(href);
          const text = h3.text().trim();
          const meta = $(li)
            .find("ul.meta li")
            .map((_, mli) => $(mli).text().trim())
            .get();
          items.push({ text, id, href, meta });
        });
      if (items.length) sidebarSections.push({ sectionTitle, items });
    });

    // 🧠 Main Sections
    const mainSections = [];
    $("div.row > div.12u > section").each((_, section) => {
      const sectionTitle = $(section).find("h2").first().text().trim();
      const videos = [];

      $(section)
        .find("div.4u")
        .each((_, div4u) => {
          const sec = $(div4u).find("section").first();
          if (!sec.length) return;
          const a = sec.find("a").first();
          if (!a.length) return;

          const href = a.attr("href") ? "https://hqporner.com" + a.attr("href") : null;
          const id = extractIdFromUrl(href);
          const rawH3 = sec.find("div#span-case > h3").text().trim();
          const duration = sec.find("div#span-case > span").text().trim();
          const h3Text = rawH3.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1));
          const img = a.find("img").first();
          const poster = img.length
            ? img.attr("src").startsWith("//")
              ? "https:" + img.attr("src")
              : img.attr("src")
            : null;

          const preview = a
            .find("div.hide_noscript")
            .map((_, hideDiv) => {
              const match = ($(hideDiv).attr("onmouseover") || "").match(/"\/\/([^"]+\.jpg)"/);
              return match?.[1] ? "https://" + match[1] : null;
            })
            .get()
            .filter(Boolean);

          videos.push({ title: h3Text, id, duration, link: href, poster, preview });
        });

      if (videos.length) mainSections.push({ sectionTitle, videos });
    });

    // 🔗 Similar Links
    const similarLinks = [];
    $("div.12u").each((_, div12u) => {
      const ulActions = $(div12u).find("ul.actions");
      if (!ulActions.length) return;
      ulActions.find("li a").each((_, aEl) => {
        const $a = $(aEl);
        similarLinks.push({
          text: $a.text().trim(),
          href: $a.attr("href") ? "https://hqporner.com" + $a.attr("href") : null,
        });
      });
    });

    // ==========================================================
    // STEP 4: Return all results
    // ==========================================================
    return res.json({
      status: "success",
      videoDetails,
      sources,
      categories,
      sidebarSections,
      mainSections,
      similarLinks,
    });
  } catch (err) {
    console.error("❌ Scraper error:", err.message);
    if (!res.headersSent)
      res.status(500).json({ status: "error", message: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

module.exports = router;
