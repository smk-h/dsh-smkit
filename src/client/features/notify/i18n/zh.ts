/**
 * Simplified Chinese dictionary for the `notify` locale namespace.
 *
 * The notify tab's own copy: what a notification is, the two toggles and
 * their trade-offs, the test fire's promise, and the one environmental caveat
 * (Windows-only, Focus Assist) a user blaming the plugin needs to read first.
 * The tab label lives in the merged section's dictionary — the strip names
 * its pages, not the pages themselves.
 */

import type { LocaleDict } from '../../../platform/types'

export const NOTIFY_LOCALE_ZH: LocaleDict = {
  intro:
    'dsh 的任务完成、出错，或需要你确认工具调用、回答问题时，会弹出通知并播放提示音；页面正在前台聚焦时不打扰。',
  enabledTitle: '桌面通知',
  enabledHelp: '关闭后不再弹任何通知，也不播放提示音。',
  soundTitle: '提示音',
  soundHelp: '弹通知时附带一声提示音，音色与 ZCode 相同；关闭则静音弹出。',
  durationTitle: '常驻时长',
  durationHelp:
    '通知在屏幕右下角停留多久，之后进通知中心；「常驻」会一直显示，直到手动关闭。仅 Windows 系统通知生效，浏览器通知的时长由浏览器决定。',
  durationShort: '标准（约 5 秒）',
  durationLong: '加长（约 25 秒）',
  durationReminder: '常驻，直到手动关闭',
  webNotifTitle: '浏览器通知',
  webNotifHelp:
    '页面保持开启并授权后，通知由浏览器弹出，点击聚焦回本页（不新开标签页）；dsh 跑在远程主机上时这是唯一的通知方式，页面关闭后收不到。',
  webNotifEnable: '授权通知',
  webNotifGranted: '已授权',
  webNotifDenied: '已被拒绝，请在浏览器的站点设置中重新允许',
  webNotifUnsupported: '当前环境不支持，需通过 localhost 或 https 访问',
  webNotifFailed: '授权请求失败。',
  on: '已开启',
  off: '已关闭',
  testButton: '发送测试通知',
  testDone: '已发送，请留意屏幕右下角。',
  testFailed: '测试通知发送失败（{status}）。',
  saveFailed: '保存失败（{status}）。',
  note:
    'Windows 下若页面未开启，由 dsh 进程弹系统通知兜底，点击会新开一个 dsh 页面；专注助手/勿扰模式可能拦截系统通知。',
}
