const isVercel = process.env.VERCEL_ENV === 'production';
let puppeteer;
let chromium;

async function getBrowser() {
  // Dynamically import the required packages
  if (isVercel) {
    // In Vercel environment
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
    
    // Set the path for the Chromium executable
    chromium.setGraphicsMode = () => {};
    
    const launchOptions = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    };
    
    return await puppeteer.launch(launchOptions);
  } else {
    // In local development
    puppeteer = require('puppeteer');
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      ignoreHTTPSErrors: true,
    };
    
    // Use system Chrome if available
    if (process.platform === 'win32') {
      launchOptions.executablePath = process.env.CHROME_PATH || 
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }
    
    return await puppeteer.launch(launchOptions);
  }
}

module.exports = { getBrowser };
