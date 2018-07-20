const https = require('follow-redirects').https;
const winston = require('winston');
const JSON5 = require('json5');

const myFormat = winston.format.printf(info => {
  return `${info.timestamp} [${info.label}] ${info.level} ${info.message}`;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.label({label: 'simplescrape'}),
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

var checkProperty = function(property) {

  return new Promise(function(resolve, reject) {

    if(typeof property.link == 'undefined' || !property.link || !property.link.includes('http')) {
      logger.info(property.address + ' does not have listing on REA, adding as-is');
      return resolve(property);
    }

    logger.info('Fetching ' + property.link + ' for ' + property.address);

    https.get(property.link, (res) => {
      let body = [];
      var retVal = property;
      res.setEncoding('utf8');

      if(res.statusCode != 200)
        logger.warn('Non-200 response from ' + property.link + ' (' + res.statusCode + ')');

      res.on('data', function(chunk) {
        body.push(chunk);
      });

      res.on('end', () => {

        if(res.statusCode >= 400) {
          //Couldn't get info
          return resolve(retVal);
        }

        logger.info('Got ' + body.join('').length + ' bytes from ' + property.link);

        logger.debug('Attempt to pull extra info from the Javascript initialState variable');
        var re = /.*initialState \= (.*);/g;
        var found = re.exec(body.join(''));

        if(found) {
          try {
            logger.debug('initialState variable found, attempting to decode');
            var pageJSON = JSON.parse(found[1]).pageData.data;

            // Convert string to integer
            var price = parseInt(pageJSON.price.display.replace(/[$,-]/g, ''), 10);

            // Don't overwrite existing price with 0, it might have been listed on Auction Results page
            if(price)
              retVal.price = price;

            retVal.address = pageJSON.address.streetAddress;
            retVal.suburb = pageJSON.address.locality;

            // Avoid errors if dateSold variable isn't set
            if(pageJSON.dateSold.value)
              retVal.soldDate = new Date(pageJSON.dateSold.value);

            retVal.bedrooms = pageJSON.features.general.bedrooms;
            retVal.bathrooms = pageJSON.features.general.bathrooms;
            retVal.carspots = pageJSON.features.general.parkingSpaces;

            // Avoid errors if landSize variable isn't set
            if(pageJSON.landSize)
              retVal.landSize = pageJSON.landSize.value;

            retVal.propertyType = pageJSON.propertyType;
            retVal.originalData = pageJSON;
            retVal.latitude = pageJSON.address.location.latitude;
            retVal.longitude = pageJSON.address.location.longitude;

            return resolve(retVal);
          } catch(e) {
            logger.warn('Error parsing initialState from ' + property.link + ': ' + e);
            logger.debug(found);
            // fall through and try method 2
          }
        }

        logger.debug('Attempt to pull extra info from the Javascript Data.listings variable');
        re = /(?:.*Data\.listings\=\[)(.*?)(?:\];)/g;
        found = re.exec(body.join(''));

        if(found && typeof found[1] == 'string') {
          try {

            // Gross substitution to allow JSON decoding of object declaration, without using eval (dangerous)
            //var object = found[1].replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:(?!\/\/)/g, '"$2":');

            // Use JSON5 to decode the Object declaration syntax
            logger.debug('Data.listings variable found, attempting to decode');
            var pageJSON = JSON5.parse(found[1]);
            retVal.suburb = pageJSON.city;
            retVal.address = pageJSON.streetAddress;
            retVal.bedrooms = pageJSON.numBeds;
            retVal.propertyType = pageJSON.propertyTypeE.toLowerCase();
            retVal.originalData = pageJSON;
            retVal.latitude = pageJSON.latitude;
            retVal.longitude = pageJSON.longitude;
            return resolve(retVal);
          } catch(e) {
            logger.warn('Error parsing ' + property.link + ' (type 2): ' + e);
            logger.debug(found[1]);
            // fall through to resolve or reject below
          }
        }

        // TODO: Parse the page for the other stuff, probably with selenium

        //Couldn't get info
        logger.debug('No extra info could be gleaned');
        return resolve(retVal);

      });
    }).on('error', (e) => {
      // TODO: Investigate socket disconnections/hangups, which may be due to rate of querying
      logger.warn('Error while fetching ' + property.link + ': ' + e);
      return resolve(property);
    });

  });
};

exports.checkProperty = checkProperty;
