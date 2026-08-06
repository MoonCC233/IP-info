const WEATHER_CODE_MAP = {
  0: "晴",
  1: "大部晴朗",
  2: "多云",
  3: "阴天",
  45: "雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "中毛毛雨",
  55: "大毛毛雨",
  56: "冻毛毛雨",
  57: "强冻毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "小阵雨",
  81: "中阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴大冰雹",
};

export async function getWeather(lat, lon) {
  try {
    if (lat == null || lon == null) {
      return null;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data && data.current) {
      const temp = Math.round(data.current.temperature_2m);
      const code = data.current.weather_code;
      const desc = WEATHER_CODE_MAP[code] || "未知";

      return {
        temperature: temp,
        description: desc,
        text: `${desc} ${temp}℃`,
      };
    }

    return null;
  } catch {
    return null;
  }
}