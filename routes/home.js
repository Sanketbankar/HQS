const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

// Extract ID from a full URL
function extractIdFromUrl(url) {
    if (!url) return null;
    const parts = url.split('/');
    const lastPart = parts.pop() || parts.pop(); // handle possible trailing slash
    return lastPart || null;
}

// Main route for /api/home
router.get('/', async (req, res) => {
    try {
        const response = await axios.get('https://hqporner.com/');
        const $ = cheerio.load(response.data);

        const siteTitle = $('header h1').text().trim();
        const results = {
            [siteTitle]: [],
            genres: [],
            categories: [],
            girls: []
        };

        // Scrape video data
        $('div.6u').each((i, div6u) => {
            const sections = $(div6u).find('section');

            sections.each((j, section) => {
                const a = $(section).find('a').first();
                const href = a.attr('href') ? 'https://hqporner.com' + a.attr('href') : null;
                const id = href ? '/hdporn/' + extractIdFromUrl(href) : null;

                const rawH3 = $(section).find('div#span-case > h3').text().trim();
                const duration = $(section).find('div#span-case > span').text().trim();

                const h3Text = rawH3.replace(/\w\S*/g, (txt) =>
                    txt.charAt(0).toUpperCase() + txt.slice(1)
                );

                const w403Div = a.find('div.w403px').first();

                let imgSrc = null;
                const imgTag = w403Div.find('img').first();
                const rawSrc = imgTag.attr('src');
                if (rawSrc && rawSrc.startsWith('//')) {
                    imgSrc = 'https:' + rawSrc;
                }

                const jpgFromHideList = [];
                w403Div.find('div.hide_noscript').each((l, hideDiv) => {
                    const onmouseover = $(hideDiv).attr('onmouseover') || '';
                    const match = onmouseover.match(/"\/\/([^"]+\.jpg)"/);
                    if (match && match[1]) {
                        jpgFromHideList.push('https://' + match[1]);
                    }
                });

                results[siteTitle].push({
                    title: h3Text,
                    id,
                    duration,
                    link: href,
                    poster: imgSrc,
                    preview: jpgFromHideList
                });
            });
        });

        // Scrape sidebar genres
        $('div.sidebar section ul.divided > li').each((idx, liElem) => {
            const h3 = $(liElem).find('h3 a');
            const h3Text = h3.text().trim();
            const h3Href = h3.attr('href') ? 'https://hqporner.com' + h3.attr('href') : null;

            const genreItem = {
                title: h3Text,
                id: extractIdFromUrl(h3Href),
                href: h3Href
            };

            const metaItems = [];

            $(liElem).find('ul.meta > li').each((k, metaLi) => {
                if (idx === 0) {
                    // First genre: meta text, href, id
                    const metaLink = $(metaLi).find('a');
                    const metaText = metaLink.text().trim();
                    const metaHref = metaLink.attr('href') ? 'https://hqporner.com' + metaLink.attr('href') : null;

                    const metaItem = {
                        text: metaText,
                        id: extractIdFromUrl(metaHref),
                        href: metaHref
                        
                    };

                    // sub <ul> link
                    const nextUl = $(metaLi).next('ul');
                    const subLink = nextUl.find('a').first();
                    const subText = subLink.text().trim();
                    const subHref = subLink.attr('href') ? 'https://hqporner.com' + subLink.attr('href') : null;

                    if (subText && subHref) {
                        metaItem.text2 = subText;
                        metaItem.href2 = subHref;
                        metaItem.id2 = extractIdFromUrl(subHref);
                    }

                    metaItems.push(metaItem);
                } else {
                    const text = $(metaLi).text().trim();
                    if (text) metaItems.push({ text });
                }
            });

            if (metaItems.length > 0) genreItem.meta = metaItems;

            if (h3Text && h3Href) {
                results.genres.push(genreItem);
            }
        });

        // Scrape Categories
        $('section').each((i, sectionElem) => {
            const h2Text = $(sectionElem).find('h2').first().text().trim();
            if (h2Text.toLowerCase() === 'categories') {
                $(sectionElem).find('article ul li').each((j, liElem) => {
                    const a = $(liElem).find('a').first();
                    const text = a.text().trim();
                    const href = a.attr('href') ? 'https://hqporner.com' + a.attr('href') : null;
                    const id = href ? '/category/' + extractIdFromUrl(href) : null;

                    if (text && href) {
                        results.categories.push({ text, id, href });
                    }
                });
            }
        });

        // Scrape Girls
        $('section').each((i, sectionElem) => {
            const h2Text = $(sectionElem).find('h2').first().text().trim();
            if (h2Text.toLowerCase() === 'girls') {
                $(sectionElem).find('article ul li').each((j, liElem) => {
                    const a = $(liElem).find('a').first();
                    const text = a.text().trim();
                    const href = a.attr('href') ? 'https://hqporner.com' + a.attr('href') : null;
                    const id = href ? '/actress/' + extractIdFromUrl(href) : null;

                    if (text && href) {
                        results.girls.push({ text, id, href });
                    }
                });
            }
        });

        res.json({
            status: 'success',
            total: results[siteTitle].length,
            data: results
        });

    } catch (err) {
        console.error('❌ Scraping error:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

module.exports = router;
