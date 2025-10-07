const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

// Set the path for the Chromium executable
chromium.setGraphicsMode = () => {};

async function getBrowser() {
  // Launch options for different environments
  const launchOptions = {
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  };

  // In development, use the local Chrome/Chromium
  if (process.env.NODE_ENV !== 'production') {
    launchOptions.executablePath = process.env.CHROME_PATH || 
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  return await puppeteer.launch(launchOptions);
}

module.exports = { getBrowser };
