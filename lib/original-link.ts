/**
 * 源原始链接 — 移植 core/service.go GetOriginalLink
 */

export function GetOriginalLink(source: string, id: string, typeStr: string): string {
  switch (source) {
    case "netease":
      if (typeStr === "album") return `https://music.163.com/#/album?id=${id}`;
      if (typeStr === "playlist") return `https://music.163.com/#/playlist?id=${id}`;
      return `https://music.163.com/#/song?id=${id}`;
    case "qq":
      if (typeStr === "album") return `https://y.qq.com/n/ryqq/albumDetail/${id}`;
      if (id.startsWith("profile:")) return "https://y.qq.com/n/ryqq/profile";
      if (typeStr === "playlist") return `https://y.qq.com/n/ryqq/playlist/${id}`;
      return `https://y.qq.com/n/ryqq/songDetail/${id}`;
    case "kugou":
      if (typeStr === "album") return `https://www.kugou.com/album/${id}.html`;
      if (typeStr === "playlist") {
        if (id.startsWith("cloudlist:")) return "";
        return `https://www.kugou.com/yy/special/single/${id}.html`;
      }
      return `https://www.kugou.com/song/#hash=${id}`;
    case "kuwo":
      if (typeStr === "album") return `http://www.kuwo.cn/album_detail/${id}`;
      if (typeStr === "playlist") return `http://www.kuwo.cn/playlist_detail/${id}`;
      return `http://www.kuwo.cn/play_detail/${id}`;
    case "migu":
      if (typeStr === "album") return `https://music.migu.cn/v3/music/album/${id}`;
      if (typeStr === "playlist")
        return `https://music.migu.cn/v5/#/playlist?playlistId=${id}&playlistType=ordinary`;
      if (typeStr === "song") return `https://music.migu.cn/v3/music/song/${id}`;
      break;
    case "jamendo":
      if (typeStr === "album") return `https://www.jamendo.com/album/${id}`;
      if (typeStr === "playlist") return `https://www.jamendo.com/playlist/${id}`;
      if (typeStr === "song") return `https://www.jamendo.com/track/${id}`;
      break;
    case "joox":
      if (typeStr === "album") return `https://www.joox.com/hk/album/${id}`;
      if (typeStr === "playlist") return `https://www.joox.com/hk/playlist/${id}`;
      if (typeStr === "song") return `https://www.joox.com/hk/single/${id}`;
      break;
    case "qianqian":
      if (typeStr === "album") return `https://music.91q.com/album/${id}`;
      if (typeStr === "playlist") return `https://music.91q.com/songlist/${id}`;
      if (typeStr === "song") return `https://music.91q.com/song/${id}`;
      break;
    case "soda":
      if (typeStr === "album") return `https://www.qishui.com/share/album?album_id=${id}`;
      if (typeStr === "playlist") return `https://www.qishui.com/playlist/${id}`;
      break;
    case "bilibili":
      return `https://www.bilibili.com/video/${id}`;
    case "apple":
      if (typeStr === "album") return `https://music.apple.com/album/${id}`;
      if (typeStr === "playlist") return `https://music.apple.com/playlist/${id}`;
      return `https://music.apple.com/song/${id}`;
    case "fivesing":
      if (typeStr === "playlist") return `http://5sing.kugou.com/dj/${id}.html`;
      if (id.includes("/")) return `http://5sing.kugou.com/${id}.html`;
      break;
  }
  return "";
}
