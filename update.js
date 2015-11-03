#!/usr/bin/node
'use strict';

var request  = require('request');
var cheerio  = require('cheerio');
var fs       = require('fs');
var colors   = require('colors');
var log      = require('loglevel');
var filesize = require('filesize');
var mkdirp   = require('mkdirp');
var yauzl    = require("yauzl");

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

process.chdir(__dirname);

var cat = {
  safe_mode: '0_safe_mode',
  kill: '1_kill',
  fast: '2_fast',
  slow: '3_slow',
  extra: '4_extra',
  rootkit: '2_rootkit',
  diagnosis: '4_extra',
  tools: 'tools',
  fix: '5_fix',
  tuneup: '5_fix',
  install: 'installables',
  mac: 'mac',
  licences_and_passwords: 'licences_and_passwords'
}

function parse(url, selectors, prefix, category, filetype) {
  if (options.category && options.category != category) {
    return;
  }
  if (options.filter && url.indexOf(options.filter) < 0 && prefix.indexOf(options.filter) < 0) {
    log.info('Skipping'.green, url);
    return;
  }
  log.debug('parse'.magenta, url, ',', selectors, ',', prefix, ',', category, ',', filetype);
  
  request(url, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      //log.info(body); // Show the HTML
      
      let $ = cheerio.load(body);
      let seen = [];
      let selector;
      
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
        
        let newUrl = this.attribs.href || this.attribs.src;
        if (newUrl) {
          newUrl = newUrl.replace(/⟨/g, '&'); // hacky bugfix, sometimes the last & of an url gets changed to (
        }
        else { // this case needs a little love
          newUrl = $(this).attr('content');
          log.debug("content url", newUrl);
          let idx = newUrl.indexOf('=');
          if (idx < 0) newUrl = "";
          newUrl = newUrl.substr(idx + 1);
          log.debug(newUrl);
        }
        
        if (newUrl && seen.indexOf(newUrl) < 0) {
          seen.push(newUrl);
          log.debug('Found', newUrl);
        
          if (selectors.length) {
            parse(newUrl, selectors, prefix, category, filetype);
          }
          else {
            dl(newUrl, prefix, category, filetype, url);
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

function bleepingcomputer(url, prefix, category, filetype) {
  // Download a file from its page on bleepingcomputer
  // We assume that the first dl_but_choice is the one we want
  let selectors = ['.cz-software-download-area a', 'meta[content^=3]'];//meta[content^=3] //a:contains("click here")
  filetype = filetype || '.exe';
  
  let idx = url.lastIndexOf('/', url.length - 2);
  let name = url.slice(idx + 1, -1) + filetype;
  
  parse(url, selectors, prefix, category);
}

function dl(url, prefix, category, filetype, referer) {
  if (options.category && options.category != category) {
    return;
  }
  if (options.filter && url.indexOf(options.filter) < 0 && prefix.indexOf(options.filter) < 0) {
    log.info('Skipping'.green, url);
    return;
  }
  log.debug('dl'.magenta, url, ',', prefix, ',', category, ',', filetype);
  
  if (!category) {
    log.error('No category given for'.red.bold, url);
    return;
  }
  
  // create category directory
  if (mkdirp.sync('Downloads/' + category)) {
    log.info('Created directory'.cyan.bold, 'Downloads/' + category);
  }
  
  // Set download options
  let requestOptions = {
    url: url,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.93 Safari/537.36',
      //'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      //'Accept-Encoding': 'gzip, deflate',
      //'Accept-Language': 'fr,en;q=0.8,en-US;q=0.6',
    }
  };
  if (referer) {
    requestOptions.headers['Referer'] = referer;
  }
  
  // Get download filename
  request
    .head(requestOptions)
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
    let name = parseName(host, path, prefix, filetype);
    let destination = 'Downloads/' + category + '/' + name;
    
    // check for an existing file of matching name & size
    // TODO save ETag and check that
    let fsize = getFileSize(destination);
    
    if (fsize && fsize == size) {
      log.info('Up-to-date'.green.bold, category, '-'.green, name);
      return;
    }
    
    /*
     * While it may seem better to do a HEAD request first, and then check whether
     * we have the file or not, a lot of servers return 0 for the content length.
     * So instead, we check while the download starts, and abort if need be.
     */
    let req = request.get(requestOptions);
    req.on('response', function(response) {
      log.debug('Getting name'.cyan.bold, url, response.request.path.cyan.bold);
      log.trace(response);
      log.debug(response.headers);
      
      // check size again
      let size = response.headers['content-length'];
      if (!fsize || fsize != size) {
        log.info('Downloading'.yellow.bold, name,'->'.yellow, category.green, '(', filesize(size || 0), ')');
        // add pipe
        req.pipe(fs.createWriteStream(destination));
      }
      else {
        log.info('Up-to-date'.green.bold, category, '-'.green, name);
        req.abort();
      }
    })
    .on('error', function(response) {
      log.error('Error downloading'.red.bold, url);
      log.error(response.headers);
    })
    .on('complete', function(response) {
      log.info(name.yellow.bold, 'written', 'to', category.yellow.bold);
      if (/\.zip$/.test(destination)) {
        unzip(destination);
      }
    })
  }
}

function parseName(host, path, prefix, filetype) {
  let name = '';
  
  if (prefix == 'SuperAntiSpyware_Portable') {
    // SuperAntiSpyware servers give a new random filename each time
    name = prefix + filetype;
  }
  else {
    // Clean parameters
    let idx = path.indexOf('?');
    if (idx > 0) {
      log.trace('? in path', path, '->', path.substring(1, idx));
      path = path.substring(1, idx);
    }
    
    // if path endswith / then we are going to have to add a file extension to the name
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
    let stat = fs.statSync(destination);
    log.trace(stat);
    log.debug('File size'.cyan, stat.size)
    return stat.size;
  }
  else {
    log.debug('File not found'.cyan);
    return undefined;
  }
}

function unzip(zipfilename) {
  
  let destination = zipfilename.replace(/\.zip$/, '/');
  log.info('Unzipping'.blue.bold, zipfilename, 'to'.blue, destination);
  
  // Prepare destination directory
  if (fs.existsSync(destination)) {
    // Archive the old extracted files
    let ts_hms = new Date();
    let archive = destination.slice(0, -1).replace(/^.*\//, 'Old_zips/')
    archive += "_archived_" + ts_hms.toISOString();
    if (!fs.existsSync('Old_zips')) {
      fs.mkdirSync('Old_zips');
    }
    fs.renameSync(destination, archive);
  }
  fs.mkdirSync(destination);
  
  yauzl.open(zipfilename, function(err, zipfile) {
    if (err) {
      log.error('Error unzipping'.red.bold, zipfilename);
      log.error(err);
    }
    else {
      zipfile.on("entry", function(entry) {
        if (/\/$/.test(entry.fileName)) {
          // directory file names end with '/'
          mkdirp(destination + entry.fileName);
          return;
        }
        zipfile.openReadStream(entry, function(err, readStream) {
          if (err) throw err;
          // ensure parent directory exists, and then: 
          readStream.pipe(fs.createWriteStream(destination + entry.fileName));
          log.trace('Extracting file', destination + entry.fileName);
        });
      });
    }
  });
}

// Kill running stuff & fix a few basic probs
bleepingcomputer('http://www.bleepingcomputer.com/download/rkill/', '', cat.kill);
//*/

// Fast acting tools
bleepingcomputer('http://www.bleepingcomputer.com/download/adwcleaner/', '', cat.fast); // nice, quick and effective
dl('http://media.kaspersky.com/utilities/VirusUtilities/EN/tdsskiller.exe', 'Kaspersky_Rootkit-Killer', cat.fast); // 2mins
dl('http://devbuilds.kaspersky-labs.com/devbuilds/KVRT/latest/full/KVRT.exe', 'Kaspersky_Virus-Removal-Tool', cat.fast); // 2-3 mins
dl('http://downloads.malwarebytes.org/file/jrt', 'Malwarebytes_junkware-removal-tool', cat.fast); // 2-3 mins
bleepingcomputer('http://www.bleepingcomputer.com/download/mcafee-labs-rootkit-remover/', 'McAfee-Labs', cat.fast); // real fast
dl('https://zemana.com/Download/AntiMalware/Portable/Zemana.AntiMalware.Portable.exe?new_affid=189', '', cat.fast); // 2mins, found bad root certificat
parse('http://housecall.trendmicro.com/', ['#download-form a.button'], 'TrendMicro', cat.fast); // 5mins
parse('http://www.surfright.nl/en/products/', ['a[href^="http://dl.surfright.nl/HitmanPro"]'], '', cat.fast); // 10 mins, more if stuff needs analysing online
parse('http://www.bitdefender.com/solutions/adware-removal-tool-for-pc.html', ['.free-download'], 'BitDefender-AdWare-Remover', cat.fast); // 10mins, finds stuff others don't
bleepingcomputer('http://www.bleepingcomputer.com/download/combofix/', 'Win8.0-max', cat.fast); // can be slow 12mins on healthy win7
//*/

// Detect rootkits
bleepingcomputer('http://www.bleepingcomputer.com/download/panda-anti-rootkit/', 'Panda', cat.rootkit); // not for win7
bleepingcomputer('http://www.bleepingcomputer.com/download/rootkitrevealer/', 'Microsoft', cat.rootkit); // didn't seem to work
parse('http://free.antivirus.com/us/rootkit-buster/index.html', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.rootkit); // vfast
//*/

// Slower antistuffs
dl('https://downloads.malwarebytes.org/file/mbar/', 'Malwarebytes_AntiRootkit_Beta', cat.slow); // >30mins
dl('http://dl.emsisoft.com/EmsisoftEmergencyKit.exe', '', cat.slow);
bleepingcomputer('http://www.bleepingcomputer.com/download/aswmbr/', 'Avast', cat.slow); // slow ~25mins
bleepingcomputer('http://www.bleepingcomputer.com/download/roguekiller/', '', cat.slow); // ~15mins
//*/

// Extra checks
bleepingcomputer('http://www.bleepingcomputer.com/download/hijackthis/', '', cat.diagnosis);
//*/

// Fixers
dl('http://media.kaspersky.com/utilities/VirusUtilities/RU/cleanautorun.exe', 'Kaspersky', cat.fix);
dl('http://kb.eset.com/library/ESET/KB%20Team%20Only/Malware/ServicesRepair.exe', 'ESET', cat.fix);
parse('http://www.tweaking.com/content/page/windows_repair_all_in_one.html', ['a[href^="http://www.tweaking.com/files/setup"][href$=".zip"]'], '', cat.fix);
dl('https://downloads.malwarebytes.org/file/startuplite', 'Malwarebytes', cat.tuneup);
//*/

// Tools
bleepingcomputer('http://www.bleepingcomputer.com/download/autoruns/', '', cat.tools);
bleepingcomputer('http://www.bleepingcomputer.com/download/process-explorer/', '', cat.tools);
parse('http://support.eset.de/kb3527/', ['a[href^="http://download.eset.com"]'], 'ESET', cat.tools);
parse('http://launcher.nirsoft.net/download.html', ['a[href^="http://download.nirsoft.net/nirsoft_package_1"]'], '', cat.tools);
//*/

// Installables
dl('https://downloads.malwarebytes.org/file/mbam_current/', 'Malwarebytes', cat.install);
dl('https://downloads.malwarebytes.org/file/chameleon/', 'Malwarebytes', cat.install);
bleepingcomputer('http://www.bleepingcomputer.com/download/emsisoft-antimalware/', '', cat.install);
dl('https://downloads.malwarebytes.org/file/fileassassin/', 'Malwarebytes', cat.install); // not portable
dl('https://downloads.malwarebytes.org/file/regassassin/', 'Malwarebytes', cat.install);  // not portable
dl('http://www.superantispyware.com/sasportablehome.php', 'SuperAntiSpyware_Portable', cat.install, '.exe'); // not portable
bleepingcomputer('http://www.bleepingcomputer.com/download/sophos-virus-removal-tool/', '', cat.install); // not portable
parse('http://free.antivirus.com/us/rubotted/', ['.cta-primary', 'tr .file_link'], 'TrendMicro', cat.install);
//*/

// Product keys & passwords
dl('http://download.keit.co/current/recall.zip', 'keit.co', cat.licences_and_passwords); // can be pretty slow but seems thorough
//*/

// Stuff for mac
dl('https://downloads.malwarebytes.org/file/mbam_for_mac/', 'Malwarebytes', cat.mac, '.dmg');




/*
 * Other tools I want on my technicien's USB key
 * 
 * Greenshot portable
 * Glary portable
 * Glary installer
 * CCleaner portable & installer
 * Defraggler portable & installer
 * Recuva portable & installer
 * 
 * 
 * 
 */