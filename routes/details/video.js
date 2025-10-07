const express = require("express");
const { getBrowser } = require("../../utils/browser");

const router = express.Router();
const BASE = "https://hqporner.com/hdporn";

/**
 * Extract video sources from a Puppeteer context (page or iframe)
 */
async function extractSources(context, selector) {
  try {
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
  } catch (error) {
    console.error('Error extracting sources:', error);
    return [];
  }
}

router.get("/:id", async (req, res) => {
  let browser;
  let url;
  
  try {
    console.log('Starting video request for ID:', req.params.id);
    const { id } = req.params;
    
    if (!id || typeof id !== 'string' || id.includes('..')) {
      console.error('Invalid video ID:', id);
      return res.status(400).json({
        success: false,
        error: 'Invalid video ID'
      });
    }
    
    url = `${BASE}/${id}.html`;
    console.log('Processing URL:', url);
    
    // Launch browser using our utility
    console.log('Launching browser...');
    browser = await getBrowser();
    const page = await browser.newPage();
    
    console.log('Setting up page...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Navigate to the page
    console.log('Navigating to URL...');
    const response = await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });
    
    if (!response || !response.ok()) {
      throw new Error(`Failed to load page: ${response ? response.status() : 'No response'}`);
    }

    // Extract video sources
    const sources = await extractSources(page, 'video');
    
    // Extract other metadata
    const title = await page.title();
    const thumbnail = await page.evaluate(() => {
      const img = document.querySelector('meta[property="og:image"]');
      return img ? img.content : '';
    });

    const description = await page.evaluate(() => {
      const desc = document.querySelector('meta[name="description"]');
      return desc ? desc.content : '';
    });

    const tags = await page.evaluate(() => {
      const tagElements = document.querySelectorAll('.tags a');
      return Array.from(tagElements).map(tag => tag.textContent.trim());
    });

    res.json({
      success: true,
      data: {
        title,
        thumbnail,
        sources,
        description,
        tags,
      }
    });
  } catch (error) {
    console.error('Error in video route:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      url: url,
      params: req.params,
      query: req.query
    });
    
    res.status(500).json({
      success: false,
      error: 'An error occurred while processing your request',
      details: process.env.NODE_ENV === 'production' ? undefined : error.message
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
  }
});

module.exports = router;
