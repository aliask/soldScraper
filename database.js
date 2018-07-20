const mysql = require('mysql');
const winston = require('winston');

const myFormat = winston.format.printf(info => {
  return `${info.timestamp} [${info.label}] ${info.level} ${info.message}`;
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.label({label: 'database'}),
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

var connection = mysql.createConnection({
  host: 'localhost',
  user: 'soldproperties',
  password: 'soldproperties',
  database: 'soldproperties'
});

var connected = false;

var init = function() {
  connection.connect(function(err) {
    if (err) {
      logger.error('Error connecting to SQL DB: ' + err.stack);
      return;
    }

    logger.info('Connected to DB');
    connected = true;
  });
};

var storeProperty = function(property) {

  return new Promise(function(resolve, reject) {

    if(!connected) {
      logger.error('Can\'t store property, database not connected');
      return reject('Not connected');
    }

    logger.debug('Storing ' + property.address);

    /*  Mysqljs converts Date objects into 'YYYY-mm-dd HH:ii:ss',
        which won't match the WHERE clause because of timezone conversions */
    var sqlDate = property.soldDate.toISOString().slice(0, 10);

    var query = connection.query({
      sql: 'SELECT id FROM `sales` WHERE `address` = ? AND `date` = ?',
      values: [property.address, sqlDate]
    }, function(error, results, fields) {
      if(error)
        return reject('SQL error on SELECT: ' + error);

      if(results && results.length) {
        // Property is already in the DB, update the fields with latest info
        let updateQuery = connection.query({
          sql: 'UPDATE `sales` SET ' +
                  '`suburb`=?, ' +
                  '`price`=?, ' +
                  '`bedrooms`=?, ' +
                  '`bathrooms`=?, ' +
                  '`carspots`=?, ' +
                  '`link`=?, ' +
                  '`propertyType`=?, ' +
                  '`landSize`=?, ' +
                  '`latitude`=?, ' +
                  '`longitude`=?, ' +

                  '`otherdata`=?' +
                ' WHERE `id`=?',
          values: [
              property.suburb,
              property.price,
              property.bedrooms,
              property.bathrooms,
              property.carspots,
              property.link,
              property.propertyType,
              property.landSize,
              property.latitude,
              property.longitude,

              JSON.stringify(property.originalData),
              results[0].id
            ]
        }, function(error, results, fields) {
          if(error)
            return reject('SQL error on UPDATE: ' + error);

          logger.info(property.address + ' updated');

          return resolve();
        });
        logger.debug(updateQuery.sql);

      } else {
        // Property isn't in the database yet, add it
        let insertQuery = connection.query({
          sql: 'INSERT INTO `sales` (' +
                  '`address`, ' +
                  '`suburb`,' +
                  '`price`, ' +
                  '`bedrooms`, ' +
                  '`bathrooms`, ' +
                  '`carspots`, ' +
                  '`date`, ' +
                  '`link`, ' +
                  '`propertyType`, ' +
                  '`landSize`, ' +
                  '`latitude`, ' +
                  '`longitude`,' +

                  '`otherdata` ' +
                ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          values: [
              property.address,
              property.suburb,
              property.price,
              property.bedrooms,
              property.bathrooms,
              property.carspots,
              sqlDate,
              property.link,
              property.propertyType,
              property.landSize,
              property.latitude,
              property.longitude,

              JSON.stringify(property.originalData)
            ]
        }, function(error, results, fields) {
          if(error) {
            return reject('SQL error:' + error);
          }

          logger.info(property.address + ' added');

          return resolve();
        });

        logger.debug(insertQuery.sql);
      }
    });

  });

};

var end = function() {
  connection.destroy();
};

exports.init = init;
exports.storeProperty = storeProperty;
exports.end = end;
