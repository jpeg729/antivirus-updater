#!/usr/bin/node

var request = require('request');
var cheerio = require('cheerio');
var fs      = require('fs');
var colors  = require('colors');
var log     = require('loglevel');

var commandLineArgs = require("command-line-args");
var cli = commandLineArgs([
    { name: "loglevel", alias: "l", type: String },
    { name: "help", alias: "h", type: Boolean }
]);
var options = cli.parse();
log.setLevel(options.loglevel || 'info');
var usage = cli.getUsage({
    title: "antivirus-updater",
    description: "Checks for updates to my favourite antivirus tools and downloads them into the current directory",
    footer: "Project home: [underline]{https://github.com/jpcours/antivirus-updater}"
});
if (options.help) {
  console.log(usage);
  process.exit();
}

var cat = {
  safe_mode: '0_safe_mode',
  process: '1_process',
  fast: '2_fast',
  slow: '3_slow',
  extra: 'extra',
  rootkit: 'rootkit',
  diag: 'diagnosis',
  fix: 'fix',
  tuneup: 'tuneup',
  mac: 'mac'
}

function erase(pattern) {
  fs.readdir('.', function (error, files)
  {
      if (error) throw error;

      files.filter(function (fileName)
      {
          return pattern.test(fileName);
      })
      .forEach(
        function (f) {
          log.info("Deleting", f);
          fs.unlink(f);
        }
      );
  });
}

function parse(url, selectors, prefix, category) {
  log.debug('parse', url, ',', selectors, ',', prefix);
  
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      //log.info(body); // Show the HTML
      
      var $ = cheerio.load(body);
      var seen = [];
      var selector;
      
      if (Array.isArray(selectors)) {
        selector = selectors.shift();
      }
      else {
        selector = selectors;
        selectors = '';
      }
      
      $(selector).each(function () {
        //log.debug(this);
        
        var url = $(this).attr('href')
          .replace(/⟨/g, '&'); // hacky bugfix, sometimes the last & of an url gets changed to (
        
        if (seen.indexOf(url) < 0) {
          seen.push(url);
          log.debug('Found', url);
        
          if (selectors.length) {
            parse(url, selectors, prefix);
          }
          else {
            dl(url, prefix);
          }
        }
      });
      
      if (seen.length == 0) {
        log.warn('Nothing found at'.magenta.bold, url.magenta.bold);
      }
      //*/
    }
    else log.error(error, response.headers);
  });
}

function dl(url, prefix, category) {
  log.debug('dl'.magenta, url, ',', prefix);
  
  var name;
  
  // Get download filename
  request
    .head(url)
    .on('response', function(response) {
      log.debug('Getting name'.yellow.bold, url, response.request.path.yellow.bold);
      log.debug(response.headers);
      parseName(response.request.host, response.request.path, response.headers['content-length']);
    })
    .on('error', function(response) {
      log.error('Error downloading'.magenta.bold, url);
      log.error(response.headers);
    })
  
  function parseName(host, name, size) {
    if (host == 'www.bleepingcomputer.com') {
      name = prefix;
    }
    else {
      var idx;
      if (name.substr(-1) == '/') {
        log.debug("String endswith /".yellow);
        idx = name.lastIndexOf('/', name.length - 2);
        name = name.slice(idx + 1, -1) + '.exe'; // horrible hack
      }
      else {
        idx = name.lastIndexOf('/');
        name = name.substring(idx + 1);
      }
      
      if (!name) {
        name = prefix;
      }
      else if (prefix) {
        name = prefix + '_' + name; // no type checking, bad
      }
    }
    log.debug('Will download'.magenta, name, 'from'.green, url);
    
    // TODO check for an existing file of matching name & size
    
    request
      .head(url)
      .on('response', function(response) {
        log.info('Downloading'.red.bold, name,'- Size', response.headers['content-length'], 'bytes');
        log.trace(response);
      })
      .on('error', function(response) {
        log.error('Error downloading'.magenta.bold, url);
        log.error(response.headers);
      })
      .on('complete', function(response) {
        log.info('Got'.green.bold, name);
      })
      //.pipe(fs.createWriteStream(category + '/' + name));
  }
}

//erase(/.exe$/);
/*dl('http://dl.emsisoft.com/EmsisoftEmergencyKit.exe', '', cat.slow);
dl('http://media.kaspersky.com/utilities/VirusUtilities/EN/tdsskiller.exe', '', cat.rootkit);
dl('http://devbuilds.kaspersky-labs.com/devbuilds/KVRT/latest/full/KVRT.exe', 'Kaspersky_VirusRemovalTool', cat.fast);
dl('http://media.kaspersky.com/utilities/VirusUtilities/RU/cleanautorun.exe', 'Kaspersky', cat.fix);
//*/
parse('http://www.bleepingcomputer.com/download/adwcleaner/', ".dl_choices .dl_but_choice:first-of-type a", 'adwcleaner.exe', cat.fast);
parse('http://www.bleepingcomputer.com/download/rkill/', ".dl_choices .dl_but_choice:first-of-type a", 'rkill.exe', cat.process);
/*dl('https://downloads.malwarebytes.org/file/mbam_current/', 'Malwarebytes', cat.slow);
//dl('https://downloads.malwarebytes.org/file/fileassassin/', 'Malwarebytes', cat.manual);
//dl('https://downloads.malwarebytes.org/file/regassassin/', 'Malwarebytes', cat.manual);
dl('https://downloads.malwarebytes.org/file/mbar/', 'Malwarebytes_AntiRootkit_Beta', cat.rootkit);
dl('https://downloads.malwarebytes.org/file/chameleon/', 'Malwarebytes', cat.slow);
dl('https://downloads.malwarebytes.org/file/startuplite', 'Malwarebytes', cat.tuneup);
dl('https://www.malwarebytes.org/mac-download/', 'Malwarebytes', cat.mac);
//*/
parse('http://www.bleepingcomputer.com/download/hijackthis/', ".dl_choices .dl_but_choice:first-of-type a", 'HijackThis.exe', cat.diagnosis);

parse('http://housecall.trendmicro.com/', "#download-form a.button", 'TrendMicro', cat.extra);
parse('http://free.antivirus.com/us/rootkit-buster/index.html', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);
parse('http://free.antivirus.com/us/rubotted/', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);

dl('http://www.superantispyware.com/sasportablehome.php', 'SuperAntiSpyware_Portable', cat.extra);
//*/