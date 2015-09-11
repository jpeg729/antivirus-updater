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
  diagnosis: 'diagnosis',
  tools: 'tools',
  fix: 'fix',
  tuneup: 'tuneup',
  mac: 'mac'
}

function parse(url, selectors, prefix, category, filetype) {
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
        
        var url = $(this).attr('href');
        if (url) {
          url = url.replace(/⟨/g, '&'); // hacky bugfix, sometimes the last & of an url gets changed to (
        }
        else {
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
  
  var name, destination;
  var dsize, host, path;
  
  /*
   * While it may seem better to do a HEAD request first, and then check whether
   * we have the file or not, a lot of servers return 0 for the content length.
   * So instead, we check while the download starts, and abort if need be.
   */
  var req = request.get(url);
  req.on('response', function(response) {
    log.debug('Getting name'.cyan.bold, url, response.request.path.cyan.bold);
    log.trace(response);
    log.debug(response.headers);
    
    // response details
    dsize = response.headers['content-length'];
    host = response.request.host;
    path = response.request.path; // not always the same as in the url, contains useful filename info
    
    // calculate destination filename
    name = parseName(host, path, prefix, filetype);
    destination = category + '/' + name;
    log.debug('Will download'.magenta, name, 'from'.green, url, 'to'.green, destination);
    
    // look for existing file & get its size
    var size = getFileSize(destination);
    
    if (size != dsize) {
      try {
        dsize = filesize(dsize);
      }
      catch (e) {
        log.warn(e)
      }
      log.info('Downloading'.yellow.bold, name,'->'.yellow, category.green, '(', dsize, ')');
      // add pipe
      req.pipe(fs.createWriteStream(destination));
    }
    else {
      log.info('Up-to-date'.green.bold, destination);
      req.abort();
    }
  })
  .on('error', function(response) {
    log.error('Error downloading'.red.bold, url);
    log.error(response.headers);
  })
  .on('complete', function(response) {
    log.info('Wrote'.green.bold, name, 'to', destination.green);
  })
}

function parseName(host, path, prefix, filetype) {
  var name;
  
  if (host == 'www.bleepingcomputer.com') {
    name = prefix;
  }
  else {
    var idx;
    if (path.substr(-1) == '/') {
      log.debug("String endswith /".cyan);
      idx = path.lastIndexOf('/', path.length - 2);
      name = path.slice(idx + 1, -1) + (filetype || '.exe'); // horrible hack
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
    return 0;
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

//erase(/.exe$/);
dl('http://dl.emsisoft.com/EmsisoftEmergencyKit.exe', '', cat.slow);
dl('http://devbuilds.kaspersky-labs.com/devbuilds/KVRT/latest/full/KVRT.exe', 'Kaspersky_VirusRemovalTool', cat.fast);
dl('http://media.kaspersky.com/utilities/VirusUtilities/RU/cleanautorun.exe', 'Kaspersky', cat.fix);
dl('http://media.kaspersky.com/utilities/VirusUtilities/EN/tdsskiller.exe', '', cat.rootkit);
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
//*/
bleepingcomputer('http://www.bleepingcomputer.com/download/roguekiller/', '', cat.extra);

parse('http://www.surfright.nl/en/products/', ['a[href^="http://dl.surfright.nl/HitmanPro"]'], '', cat.extra);


dl('https://downloads.malwarebytes.org/file/mbam_current/', 'Malwarebytes', cat.slow);
//dl('https://downloads.malwarebytes.org/file/fileassassin/', 'Malwarebytes', cat.manual);
//dl('https://downloads.malwarebytes.org/file/regassassin/', 'Malwarebytes', cat.manual);
dl('https://downloads.malwarebytes.org/file/mbar/http://dl.surfright.nl/HitmanPro_x64.exe', 'Malwarebytes_AntiRootkit_Beta', cat.rootkit);
dl('https://downloads.malwarebytes.org/file/chameleon/', 'Malwarebytes', cat.slow);
dl('https://downloads.malwarebytes.org/file/startuplite', 'Malwarebytes', cat.tuneup);
dl('https://www.malwarebytes.org/mac-download/', 'Malwarebytes', cat.mac, '.dmg');
//*/


parse('http://housecall.trendmicro.com/', ['#download-form a.button'], 'TrendMicro', cat.extra);
parse('http://free.antivirus.com/us/rootkit-buster/index.html', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);
parse('http://free.antivirus.com/us/rubotted/', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit);

dl('http://www.superantispyware.com/sasportablehome.php', 'SuperAntiSpyware_Portable', cat.extra);
//*/