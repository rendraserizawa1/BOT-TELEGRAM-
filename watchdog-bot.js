var sh = new ActiveXObject("WScript.Shell");
var fso = new ActiveXObject("Scripting.FileSystemObject");
var LOG = "C:\\Users\\kassa\\.pm2\\watchdog.log";
var BOTDIR = "C:\\Users\\kassa\\BOT-TELEGRAM-";

function log(m) {
  try {
    var f = fso.OpenTextFile(LOG, 8, true);
    f.WriteLine("[" + (new Date()).toLocaleString() + "] " + m);
    f.Close();
  } catch (e) {}
}

function healthy() {
  try {
    var x = new ActiveXObject("WinHttp.WinHttpRequest.5.1");
    x.SetTimeouts(8000, 8000, 8000, 8000);
    x.Open("GET", "http://localhost:3001/health", false);
    x.Send();
    return x.Status === 200;
  } catch (e) {
    return false;
  }
}

function pm2(a) {
  try {
    sh.Run('cmd /c pm2 ' + a, 0, true);
  } catch (e) {}
}

try {
  if (healthy()) { WScript.Quit(0); }
  sh.CurrentDirectory = BOTDIR;
  log("bot DOWN - mencoba hidupkan");
  pm2("resurrect");
  WScript.Sleep(20000);
  if (healthy()) { log("pulih via resurrect"); WScript.Quit(0); }
  pm2("start index.js --name telegram-perabot");
  pm2("save");
  WScript.Sleep(20000);
  if (healthy()) { log("pulih via start manual"); }
} catch (e) {
  log("error: " + e.message);
}
