export function parseUA(ua) {
  if (!ua) {
    return { os: "未知系统", browser: "未知浏览器" };
  }

  const os = parseOS(ua);
  const browser = parseBrowser(ua);

  return { os, browser };
}

function parseOS(ua) {
  if (/Windows NT 10\.0.*WOW64|Windows NT 10\.0.*Win64/i.test(ua)) {
    return "Windows 10/11";
  }
  if (/Windows NT 10\.0/i.test(ua)) {
    return "Windows 10/11";
  }
  if (/Windows NT 6\.3/i.test(ua)) {
    return "Windows 8.1";
  }
  if (/Windows NT 6\.2/i.test(ua)) {
    return "Windows 8";
  }
  if (/Windows NT 6\.1/i.test(ua)) {
    return "Windows 7";
  }
  if (/Windows NT 6\.0/i.test(ua)) {
    return "Windows Vista";
  }
  if (/Windows NT 5\.1/i.test(ua)) {
    return "Windows XP";
  }
  if (/Windows/i.test(ua)) {
    return "Windows";
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    if (/(?:iPhone OS|OS) (\d+[_\d]+) like Mac OS X/i.test(ua)) {
      const ver = ua.match(/(?:iPhone OS|OS) (\d+[_\d]+) like Mac OS X/i)[1].replace(/_/g, ".");
      return `iOS ${ver}`;
    }
    return "iOS";
  }
  if (/Mac OS X (\d+[_.]\d+[_.]\d+)/i.test(ua)) {
    const ver = ua.match(/Mac OS X (\d+[_.]\d+[_.]\d+)/i)[1].replace(/_/g, ".");
    return `macOS ${ver}`;
  }
  if (/Mac OS X/i.test(ua)) {
    return "macOS";
  }
  if (/Android (\d+[\d.]+)/i.test(ua)) {
    const ver = ua.match(/Android (\d+[\d.]+)/i)[1];
    return `Android ${ver}`;
  }
  if (/Android/i.test(ua)) {
    return "Android";
  }
  if (/Linux.*x86_64/i.test(ua)) {
    return "Linux (x86_64)";
  }
  if (/Linux/i.test(ua)) {
    return "Linux";
  }
  if (/HarmonyOS/i.test(ua)) {
    return "HarmonyOS";
  }
  return "未知系统";
}

function parseBrowser(ua) {
  if (/Edg\/([\d.]+)/i.test(ua)) {
    const ver = ua.match(/Edg\/([\d.]+)/i)[1];
    return `Edge(${ver})`;
  }
  if (/OPR\/([\d.]+)|Opera\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/OPR\/([\d.]+)|Opera\/([\d.]+)/i);
    const ver = match[1] || match[2];
    return `Opera(${ver})`;
  }
  if (/Firefox\/([\d.]+)/i.test(ua) && !/Edg/i.test(ua) && !/OPR/i.test(ua)) {
    const ver = ua.match(/Firefox\/([\d.]+)/i)[1];
    return `Firefox(${ver})`;
  }
  if (/Chrome\/([\d.]+)/i.test(ua) && !/Edg/i.test(ua) && !/OPR/i.test(ua)) {
    const ver = ua.match(/Chrome\/([\d.]+)/i)[1];
    return `Chrome(${ver})`;
  }
  if (/Safari\/([\d.]+)/i.test(ua) && !/Chrome/i.test(ua)) {
    const ver = ua.match(/Version\/([\d.]+)/i);
    if (ver) {
      return `Safari(${ver[1]})`;
    }
    return "Safari";
  }
  if (/MicroMessenger\/([\d.]+)/i.test(ua)) {
    const ver = ua.match(/MicroMessenger\/([\d.]+)/i)[1];
    return `微信(${ver})`;
  }
  if (/QQBrowser\/([\d.]+)/i.test(ua)) {
    const ver = ua.match(/QQBrowser\/([\d.]+)/i)[1];
    return `QQ浏览器(${ver})`;
  }
  if (/UCBrowser\/([\d.]+)/i.test(ua)) {
    const ver = ua.match(/UCBrowser\/([\d.]+)/i)[1];
    return `UC浏览器(${ver})`;
  }
  return "未知浏览器";
}