var _           = require('lodash')
  , Spreadsheet = require('edit-google-spreadsheet')
  , assert      = require('assert')
  , async       = require('async')
  , _           = require('lodash')
  //max rows to keep in the log
  , MAX_ROWS    = 50

  //When rolling logs move the last KEEP_ROWS to the top 
  , KEEP_ROWS   = 10
;

module.exports = {
    pickSheetData: function (rows, startRow, startColumn, numRows, numColumns) {
        var sheetData = []
          , row = []
        ;

        numRows    = numRows    || _.values(rows).length;
        numColumns = numColumns || _.reduce(rows, function(max, i) { return Math.max(max, _.values(i).length); }, -1);

        for (var rowKey = startRow; rowKey <= numRows; rowKey++) {
            row = [];
            sheetData.push(row);
            for (var columnKey = startColumn; columnKey <= numColumns; columnKey++) {
                if (rows[rowKey] !== undefined && rows[rowKey][columnKey] !== undefined) {
                    row.push(rows[rowKey][columnKey]);
                }
            }
        }

        return sheetData;
    }
    , getResults: function(sheet, rowID, attempts) {
        var self = this, increment=500;
        attempts = attempts || 1;
        sheet.receive({getValues: true}, function(err, rows, info) {
            //get the row
            var value = _.values(_.get(rows, '['+rowID+"]"));

            //get the last column
            value = _.get(value, ""+(value.length-1));

            if(!value && attempts < 5) {
                return setTimeout(self.getResults.bind(self, sheet, rowID, ++attempts), (attempts-1) * increment);
            } else if(attempts >= 5) {
                return self.fail("Too many attempts to retrieve and no data!");
            }

            self.complete({
                value: value
            });
        });
    }
    /**
     *  add a row to the log, rolling it if necessary
     *
     * @param {Object} vars     - The username that sent the message
     * @param {String} text     - The text that we received
     * @param {Array}  matches  - the matches that resulted from the regular exp search 
     */
    , add: function(vars, text, matches, row, dest) {
        var self = this, match;

        
        for(var i=0; i<matches.length; i++) {
            match = matches[i]
                      .replace(/[\u2018\u2019]/g, "'")
                      .replace(/[\u201C\u201D]/g, '"')
                      .replace(/"/g, '""')
            ;

            row[1] = row[1].replace(new RegExp('\\\\'+i,'g'), match);
        }

        _.each(vars, function(val, key) {
            row[1] = row[1].replace(new RegExp('%'+key+'%', 'ig'), val);
        });

        row.unshift(text);
        row.unshift((new Date()).toUTCString());

        dest.receive(function(err, rows, info) {
            var data = {};
            var rowToUse = info.lastRow + 1;
            if(rowToUse > MAX_ROWS) {
                _.each(rows, function(val, key) {
                    //respect the header row
                    var rownum = parseInt(key), overwriteRow;
                    if(rownum > (MAX_ROWS - KEEP_ROWS)) {
                        overwriteRow = MAX_ROWS-Math.min(MAX_ROWS,rownum)+2;
                        rows[overwriteRow+""] = rows[key];
                    }

                    if(key !== '1')
                        rows[key] = [_.map(val, function() { return ''; })];
                });
                rows[KEEP_ROWS+2] = [row];
                dest.add(rows);
                return dest.send(function(err) { 
                });
            } else {
                data[rowToUse] = [row];
                dest.add(data);
                dest.send(function(err) { 
                    self.getResults(dest, rowToUse);
                });
            }
        });
    }
    , parse: function(step, source, dest) {
        var text          = step.input('text').first()
          , user_id       = step.input('user_id').first()
          , channel_id    = step.input('channel_id').first()
          , self          = this
        ;

        source.receive({getValues: true}, function (error, rows) {
            if(error) return self.fail(error);

            var values = self.pickSheetData(rows, 1, 1);


            _.each(values, function(i) {
                var matches = text.match(new RegExp(i[0], 'i'));

                if(matches) {
                    matches = Array.prototype.slice.call(matches);
                    self.add({user_id: user_id, channel_id:channel_id}, text, matches, i, dest);
                    return false;
                }
            });

        });

    }

    /**
     * The main entry point for the Dexter module
     *
     * @param {AppStep} step Accessor for the configuration for the step using this module.  Use step.input('{key}') to retrieve input data.
     * @param {AppData} dexter Container for all data used in this workflow.
     */
    , run: function(step, dexter) {
        var spreadsheetId = step.input('spreadsheet_id').first()
          , source_sheet  = step.input('source_sheet').first() || 1
          , dest_sheet    = step.input('dest_sheet').first() || 2
          , self = this
          , options
        ;

        assert(spreadsheetId, "Spreadsheet key required. Look for it in the spreadsheet's URL (e.g. https://docs.google.com/spreadsheets/d/<spreadsheet_id>/edit)");

        options = {
            debug: true,
            spreadsheetId : spreadsheetId,
            accessToken   : {
                type      : 'Bearer',
                token     : dexter.provider('google').credentials('access_token')
            }
        };

        async.parallel([
            Spreadsheet.load.bind(Spreadsheet, _.extend({}, options, { worksheetId: source_sheet })),
            Spreadsheet.load.bind(Spreadsheet, _.extend({}, options, { worksheetId: dest_sheet   }))
        ], function(err, results) {
            var source = results[0]
              , dest   = results[1]
            ;

            self.parse(step, source, dest);
        });
    }
};
