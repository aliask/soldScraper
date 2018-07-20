const {Builder, By, Key, until} = require('selenium-webdriver');
var firefox = require('selenium-webdriver/firefox');
var chrome = require('selenium-webdriver/chrome');
const db = require('./database.js');
const simplescrape = require('./simplescrape.js');
const winston = require('winston');

const myFormat = winston.format.printf(info => {
  return `${info.timestamp} [${info.label}] ${info.level} ${info.message}`;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.label({label: 'soldScraper'}),
    winston.format.colorize(),
    myFormat,
  ),
  transports: [
    new winston.transports.Console({level: 'info'}),
    new winston.transports.File({
      filename: 'debug.log',
      level: 'debug'
    })
  ]
});

(async function scrape() {

  var getInfo = function(property, selector, value='text') {
    return property.findElement({ css: selector }).
          then(container => {
            switch(value) {
              case 'href':
                return container.getAttribute('href');
              case 'text':
              default:
                return container.getText();
            }
          }).
          catch(e => {
            logger.error('findElement failed: ' + e);
            driver.quit().then(_ => process.exit(1));
          });
  };

  logger.info('Starting selenium...');

  // Firefox was crashing on larger runs, so I switched to Chrome. YMMV.
  //let driver = await new Builder().forBrowser('firefox').setFirefoxOptions(new firefox.Options().headless()).build();
  let driver = await new Builder().
                forBrowser('chrome').
                setChromeOptions(
                  new chrome.Options().headless().windowSize({
                    width: 640,
                    height: 480
                  })
                ).build();

  logger.info('Connecting to database');
  await db.init();

  var results = [];
  var url = 'https://www.realestate.com.au/auction-results/vic';
  var soldProperties = [], noPrice = [], recordedProperties = [], noSale = [];

  try {

    logger.info('Fetching ' + url);
    await driver.get(url);

    await driver.getTitle().then(title => { logger.info(title); }).catch(e => logger.error(e));

    var properties = await driver.findElements({ css: '.suburb tbody tr' }).catch(e => logger.error(e));

    logger.info(properties.length + ' results');

    results = await Promise.all(properties.map(async function(property) {

      var link = await getInfo(property, '.col-address', 'href');
      var address = await getInfo(property, '.col-address');
      var price = await getInfo(property, '.col-property-price');
      if(price)
        price = parseInt(price.replace(/[$,\-]/g, ''), 10);
      if(price == NaN)
        price = 0;

      var date = await getInfo(property, '.col-auction-date');
      if(date) {
        var splitDate = date.split('/');
        date = new Date('20' + splitDate[2] + '-' + splitDate[1] + '-' + splitDate[0]);
      }

      var propertyData = {
        address: address,
        price: price,
        soldDate: date,
        link: link
      };

      var result = await getInfo(property, '.col-auction-result');

      if(!result.includes('Sold')) {
        logger.info(address + ' didn\'t sell, skipping');
        noSale.push(propertyData);
        return;
      }

      soldProperties.push(propertyData);
      logger.info(address + ' sold, getting extra data');

      await simplescrape.checkProperty(propertyData).then(retVal => {

        if(!retVal.price) {
          logger.warn('Could not determine price for ' + retVal.address);
          logger.debug(JSON.stringify(retVal));
          noPrice.push(retVal);
          return;
        }

        recordedProperties.push(retVal);

      }).catch(e => logger.error(e));

      return;

    })).then(properties => {
      logger.info('Finished scraping, closing selenium');
      driver.quit().then(_ => {

        logger.info('Selenium closed. Storing ' + recordedProperties.length + ' properties');

        Promise.all(recordedProperties.map(property => {
          return db.storeProperty(property).catch(e => logger.error(e));
        })).then(_ => {
          logger.info('Summary: ' + soldProperties.length + ' out of ' + properties.length + ' properties (' +
            ((100 * soldProperties.length) / properties.length).toFixed(1) + '%) sold.');
          logger.info('Couldn\'t detemine the price for ' + noPrice.length + ' properties. ' +
            recordedProperties.length + ' added to database.');

          logger.debug('Properties with no price');
          logger.debug(JSON.stringify(noPrice));

          logger.debug('Properties stored/updated in the DB');
          logger.debug(JSON.stringify(recordedProperties));

          logger.debug('Sold properties');
          logger.debug(JSON.stringify(soldProperties));

          logger.debug('Unsold properties');
          logger.debug(JSON.stringify(noSale));

          db.end();
          process.exitCode = 0;
        });

      });
    }).catch(e => {
      logger.error(e);
      driver.quit().then(_ => {
        db.end();
        process.exitCode = 1;
      });
    });

  } catch(e) {
    logger.error(e);
    driver.quit().then(_ => {
      db.end();
      process.exitCode = 1;
    });
  }
})();
