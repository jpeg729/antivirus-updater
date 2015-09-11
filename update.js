#!/usr/bin/node

var request = require('request');
var cheerio = require('cheerio');
var fs      = require('fs');
var colors  = require('colors');
var log     = require('loglevel');
var filesize= require('filesize');

var commandLineArgs = require("command-line-args");
var cli = commandLineArgs([
  { name: "loglevel", alias: "l", type: String },
  { name: "help", alias: "h", type: Boolean },
  { name: "category", alias: "c", type: String },
  { name: "filter", alias: "f", type: String }
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
  extra: '4_extra',
  rootkit: '2_rootkit',
  diagnosis: '4_extra',
  tools: 'tools',
  fix: '5_fix',
  tuneup: '5_fix',
  mac: 'mac'
}

function parse(url, selectors, prefix, category, filetype) {
  if (options.category && options.category != category) {
    return;
  }
  if (options.filter && url.indexOf(options.filter) < 0 && prefix.indexOf(options.filter) < 0) {
    return;
  }
  log.debug('parse'.magenta, url, ',', selectors, ',', prefix, ',', category, ',', filetype);
  
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
        log.debug('foreach a'.magenta, ',', prefix, ',', category, ',', filetype);
        log.trace(this);
        
        var url = this.attribs.href || this.attribs.src;
        if (url) {
          url = url.replace(/⟨/g, '&'); // hacky bugfix, sometimes the last & of an url gets changed to (
        }
        else { // this case needs a little love
          url = this.attribs.content;
          var idx = url.indexOf('=');
          url = url.substr(idx + 1);
        }
        
        if (seen.indexOf(url) < 0) {
          seen.push(url);
          log.debug('Found', url);
        
          if (selectors.length) {
            parse(url, selectors, prefix, category, filetype);
          }
          else {
            dl(url, prefix, category, filetype);
          }
        }
      });
      
      if (seen.length == 0) {
        log.warn('Nothing found at'.magenta.bold, url.magenta.bold);
      }
      //*/
    }
    else {
      log.error('Error downloading html file'.red.bold, url);
      log.error(error, response.headers);
      log.error('StatusCode'.red.bold, response.statusCode);
    }
  });
}

function dl(url, prefix, category, filetype) {
  if (options.category && options.category != category) {
    return;
  }
  if (options.filter && url.indexOf(options.filter) < 0 && prefix.indexOf(options.filter) < 0) {
    return;
  }
  log.debug('dl'.magenta, url, ',', prefix, ',', category, ',', filetype);
  
  if (!category) {
    log.error('No category given for'.red.bold, url);
    return;
  }
  
  // create category directory
  try {
    fs.mkdirSync(category);
    log.info('Created directory'.cyan.bold, category);
  }
  catch (e) {
    if (e.code != 'EEXIST') {
      log.error('Could not create directory'.red.bold, category.bold);
      return;
    }
  }
  
  // Get download filename
  request
    .head(url)
    .on('response', function(response) {
      log.debug('Getting name'.cyan.bold, url, response.request.path.cyan.bold);
      log.debug(response.headers);
      continu(response.request.host, response.request.path, response.headers['content-length']);
    })
    .on('error', function(response) {
      log.error('Error downloading headers'.red.bold, url);
      log.error(response.headers);
    })
  
  function continu(host, path, size) {
    var name = parseName(host, path, prefix, filetype);
    var destination = category + '/' + name;
    
    // check for an existing file of matching name & size
    // TODO save ETag and check that
    var fsize = getFileSize(destination);
    
    if (fsize && fsize == size) {
      log.info('Up-to-date'.green.bold, category, '-'.green, name);
      return;
    }
    
    request
      .get(url)
      .on('response', function(response) {
        log.info('Downloading'.yellow.bold, name,'->'.yellow, category.green, '(', filesize(size || 0), ')');
        log.trace(response);
      })
      .on('error', function(response) {
        log.error('Error downloading'.red.bold, url);
        log.error(response.headers);
      })
      .on('complete', function(response) {
        log.info('Wrote'.green.bold, name, 'to'.green, category);
      })
      .pipe(fs.createWriteStream(destination));
  }
}

function parseName(host, path, prefix, filetype) {
  var name;
  
  if (prefix == 'SuperAntiSpyware_Portable') {
    // SuperAntiSpyware servers give a new random filename each time
    name = prefix;
  }
  else {
    var idx;
    if (path.substr(-1) == '/') {
      log.debug("String endswith /".cyan);
      idx = path.lastIndexOf('/', path.length - 2);
      name = path.slice(idx + 1, -1) + (filetype || '.exe');
    }
    else {
      idx = path.lastIndexOf('/');
      name = path.substring(idx + 1);
    }
    
    if (!name) {
      name = prefix;
    }
    else if (prefix) {
      name = prefix + '_' + name; // no type checking, bad
    }
  }
  name = name.replace(/%20/g, '_');
  log.debug('parseName'.magenta, host, path, name);
  return name;
}

function getFileSize(destination) {
  
  if (fs.existsSync(destination)) {
    var stat = fs.statSync(destination);
    log.trace(stat);
    log.debug('File size'.cyan, stat.size)
    return stat.size;
  }
  else {
    log.debug('File not found'.cyan);
    return undefined;
  }
}

function bleepingcomputer(url, prefix, category, filetype) {
  // Download a file from its page on bleepingcomputer
  // We assume that the first dl_but_choice is the one we want
  selectors = ['.dl_choices .dl_but_choice:first-of-type a', 'meta[content^=3]'];
  filetype = filetype || '.exe';
  
  var idx = url.lastIndexOf('/', url.length - 2);
  name = url.slice(idx + 1, -1) + filetype;
  
  parse(url, selectors, prefix, category);
}


dl('http://dl.emsisoft.com/EmsisoftEmergencyKit.exe', '', cat.slow);
dl('http://devbuilds.kaspersky-labs.com/devbuilds/KVRT/latest/full/KVRT.exe', 'Kaspersky_VirusRemovalTool', cat.fast);
dl('http://media.kaspersky.com/utilities/VirusUtilities/RU/cleanautorun.exe', 'Kaspersky', cat.fix);
dl('http://media.kaspersky.com/utilities/VirusUtilities/EN/tdsskiller.exe', 'Kaspersky', cat.rootkit);
//*/

bleepingcomputer('http://www.bleepingcomputer.com/download/adwcleaner/', '', cat.fast);
bleepingcomputer('http://www.bleepingcomputer.com/download/rkill/', '', cat.process);
bleepingcomputer('http://www.bleepingcomputer.com/download/hijackthis/', '', cat.diagnosis);
bleepingcomputer('http://www.bleepingcomputer.com/download/mcafee-labs-rootkit-remover/', 'McAfee-Labs', cat.rootkit);
bleepingcomputer('http://www.bleepingcomputer.com/download/panda-anti-rootkit/', 'Panda', cat.rootkit);
bleepingcomputer('http://www.bleepingcomputer.com/download/sophos-virus-removal-tool/', '', cat.fast);
bleepingcomputer('http://www.bleepingcomputer.com/download/rootkitrevealer/', '', cat.rootkit);
bleepingcomputer('http://www.bleepingcomputer.com/download/autoruns/', '', cat.tools);
bleepingcomputer('http://www.bleepingcomputer.com/download/process-explorer/', '', cat.tools);
bleepingcomputer('http://www.bleepingcomputer.com/download/aswmbr/', 'Avast', cat.rootkit); // TODO better name
bleepingcomputer('http://www.bleepingcomputer.com/download/emsisoft-antimalware/', '', cat.slow);
bleepingcomputer('http://www.bleepingcomputer.com/download/roguekiller/', '', cat.extra);

parse('http://www.surfright.nl/en/products/', ['a[href^="http://dl.surfright.nl/HitmanPro"]'], '', cat.extra);
//*/


dl('https://downloads.malwarebytes.org/file/mbam_current/', 'Malwarebytes', cat.slow);
//dl('https://downloads.malwarebytes.org/file/fileassassin/', 'Malwarebytes', cat.tools);
//dl('https://downloads.malwarebytes.org/file/regassassin/', 'Malwarebytes', cat.tools);
dl('https://downloads.malwarebytes.org/file/mbar/http://dl.surfright.nl/HitmanPro_x64.exe', 'Malwarebytes_AntiRootkit_Beta', cat.rootkit);
dl('https://downloads.malwarebytes.org/file/chameleon/', 'Malwarebytes', cat.slow);
dl('https://downloads.malwarebytes.org/file/startuplite', 'Malwarebytes', cat.tuneup);
//*/
//parse('https://www.malwarebytes.org/mac-download/', '.greencta', 'Malwarebytes', cat.mac, '.dmg');


parse('http://housecall.trendmicro.com/', ['#download-form a.button'], 'TrendMicro', cat.extra);
parse('http://free.antivirus.com/us/rootkit-buster/index.html', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);
parse('http://free.antivirus.com/us/rubotted/', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);

dl('http://www.superantispyware.com/sasportablehome.php', 'SuperAntiSpyware_Portable', cat.extra);
//*/