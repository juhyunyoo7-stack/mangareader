import { describe, expect, it } from 'vitest';
import { folderPickerWorks } from '../../src/platform/web.ts';

const UA = {
  chromeWin:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  // iPadOS Safari asks for desktop sites by default: a Mac user agent (told apart by touch points)
  iPadOS17:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  iPadOS184:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  iPhone17:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iPadChrome18:
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  iPadChrome26:
    'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
};

describe('folderPickerWorks (webkitdirectory)', () => {
  it('desktop and Android: whenever the attribute exists', () => {
    expect(folderPickerWorks(UA.chromeWin, false, true)).toBe(true);
    expect(folderPickerWorks(UA.android, false, true)).toBe(true);
    expect(folderPickerWorks(UA.android, false, false)).toBe(false);
  });
  it('iOS/iPadOS: only from 18.4 on, even though the attribute exists earlier', () => {
    expect(folderPickerWorks(UA.iPadOS17, true, true)).toBe(false);
    expect(folderPickerWorks(UA.iPadOS184, true, true)).toBe(true);
    expect(folderPickerWorks(UA.iPhone17, false, true)).toBe(false);
    expect(folderPickerWorks(UA.iPadChrome18, false, true)).toBe(false);
    expect(folderPickerWorks(UA.iPadChrome26, false, true)).toBe(true);
  });
  it('a Mac (no touch) is not treated as an iPad', () => {
    expect(folderPickerWorks(UA.iPadOS17, false, true)).toBe(true);
  });
});
