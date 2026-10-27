/**
 * Tally XML exports arrive as UTF-8 or as UTF-16 ("Unicode" export), with or without a byte
 * order mark, and contain character references XML 1.0 forbids: Tally writes &#4; before
 * reserved names such as "&#4; Primary" or "&#4; Not Applicable". Parsers reject those, so
 * they are removed before parsing; the visible text is unchanged.
 */

export type DecodedXml = { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be"; removedControlRefs: number };

export function decodeTallyXml(bytes: Buffer): DecodedXml {
  let encoding: DecodedXml["encoding"] = "utf-8";
  let body = bytes;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    body = bytes.subarray(2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    body = bytes.subarray(2);
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    body = bytes.subarray(3);
  } else if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x00) {
    encoding = "utf-16le"; // "<" followed by NUL: UTF-16LE without a BOM
  } else if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x3c) {
    encoding = "utf-16be";
  }

  let text: string;
  if (encoding === "utf-16be") {
    const swapped = Buffer.from(body);
    swapped.swap16();
    text = swapped.toString("utf16le");
  } else {
    text = body.toString(encoding === "utf-16le" ? "utf16le" : "utf8");
  }

  let removedControlRefs = 0;
  // Character references to C0 controls other than tab, LF and CR (decimal or hex).
  text = text.replace(/&#(?:x0*([0-8bcef]|1[0-9a-f])|0*([0-8]|1[124-9]|2[0-9]|3[01]));/gi, () => {
    removedControlRefs += 1;
    return "";
  });
  // Raw control characters are equally invalid.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, () => {
    removedControlRefs += 1;
    return "";
  });
  return { text, encoding, removedControlRefs };
}
