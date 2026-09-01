/* export.js — take any table on the page out of the page.
 *
 * Analysts drop tables into models and decks; a dashboard that cannot be
 * extracted is a demo. Three routes, no dependencies:
 *
 *   xlsx   a real workbook, one sheet per table, built here: a zip
 *          archive with stored (uncompressed) members, which needs only
 *          a CRC-32 and the SpreadsheetML XML — about a hundred lines
 *          and no library
 *   csv    the same rows as text, for anything that reads a file
 *   print  the browser's own PDF, through a print stylesheet, with a
 *          dated header naming the company and the sources
 *
 * Every export carries its provenance: the company, the page, the date
 * generated, and the source line the page prints in its footer, so a
 * table pasted into a deck still says where it came from.
 */
(function () {
  "use strict";

  /* ---------- table → rows ---------- */
  function tableRows(table) {
    var rows = [];
    table.querySelectorAll("tr").forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll("th, td").forEach(function (c) {
        /* the period-end line under a header joins the header text */
        cells.push(c.textContent.replace(/\s+/g, " ").trim());
      });
      if (cells.length) rows.push(cells);
    });
    return rows;
  }

  /* ---------- numbers stay numbers in the workbook ---------- */
  function cellValue(text) {
    var t = String(text).replace(/[,$]/g, "").replace(/−/g, "-").trim();
    var mult = 1;
    if (/T$/.test(t)) { mult = 1e12; t = t.slice(0, -1); }
    else if (/B$/.test(t)) { mult = 1e9; t = t.slice(0, -1); }
    else if (/M$/.test(t)) { mult = 1e6; t = t.slice(0, -1); }
    else if (/K$/.test(t)) { mult = 1e3; t = t.slice(0, -1); }
    if (/^-?\d+(\.\d+)?%$/.test(t)) return { n: parseFloat(t) / 100, fmt: "pct" };
    if (/^-?\d+(\.\d+)?×$/.test(t)) return { n: parseFloat(t), fmt: "x" };
    if (/^-?\d+(\.\d+)?$/.test(t) && mult !== 1) return { n: parseFloat(t) * mult, fmt: "num" };
    if (/^-?\d+(\.\d+)?$/.test(t)) return { n: parseFloat(t), fmt: "num" };
    return null;
  }

  /* ---------- CRC-32, the only arithmetic a stored zip needs ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(s) { return new TextEncoder().encode(s); }
  function le16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function le32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  /** A zip archive of stored members: [{name, data:Uint8Array}] → Blob */
  function zipStored(members) {
    var parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    members.forEach(function (m) {
      var name = utf8(m.name), data = m.data, crc = crc32(data);
      var local = [].concat(le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(dosTime), le16(dosDate),
        le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0));
      parts.push(new Uint8Array(local), name, data);
      central.push([].concat(le32(0x02014b50), le16(20), le16(20), le16(0x0800), le16(0), le16(dosTime), le16(dosDate),
        le32(crc), le32(data.length), le32(data.length), le16(name.length), le16(0), le16(0), le16(0), le16(0),
        le32(0), le32(offset)), name);
      offset += local.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) { parts.push(new Uint8Array(c[0]), c[1]); cdSize += c[0].length + c[1].length; });
    parts.push(new Uint8Array([].concat(le32(0x06054b50), le16(0), le16(0), le16(members.length), le16(members.length),
      le32(cdSize), le32(cdStart), le16(0))));
    return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- SpreadsheetML ---------- */
  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function colName(i) {
    var s = "";
    i += 1;
    while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function sheetXml(rows) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    rows.forEach(function (row, r) {
      out.push('<row r="' + (r + 1) + '">');
      row.forEach(function (cell, c) {
        var ref = colName(c) + (r + 1);
        var v = r === 0 ? null : cellValue(cell);
        if (v) {
          var style = v.fmt === "pct" ? 2 : v.fmt === "x" ? 3 : 1;
          out.push('<c r="' + ref + '" s="' + style + '"><v>' + v.n + '</v></c>');
        } else {
          out.push('<c r="' + ref + '" t="inlineStr"' + (r === 0 ? ' s="4"' : "") + '><is><t>' + xmlEsc(cell) + '</t></is></c>');
        }
      });
      out.push("</row>");
    });
    out.push("</sheetData></worksheet>");
    return out.join("");
  }
  function workbook(sheets) {
    var wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'];
    sheets.forEach(function (s, i) {
      wb.push('<sheet name="' + xmlEsc(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
    });
    wb.push("</sheets></workbook>");
    var rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
    sheets.forEach(function (s, i) {
      rels.push('<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>');
    });
    rels.push('<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    rels.push("</Relationships>");
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0%"/><numFmt numFmtId="165" formatCode="0.0&quot;×&quot;"/></numFmts>' +
      '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>';
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") + "</Types>";
    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var members = [
      { name: "[Content_Types].xml", data: utf8(types) },
      { name: "_rels/.rels", data: utf8(rootRels) },
      { name: "xl/workbook.xml", data: utf8(wb.join("")) },
      { name: "xl/_rels/workbook.xml.rels", data: utf8(rels.join("")) },
      { name: "xl/styles.xml", data: utf8(styles) },
    ];
    sheets.forEach(function (s, i) {
      members.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: utf8(sheetXml(s.rows)) });
    });
    return zipStored(members);
  }

  /* ---------- provenance ---------- */
  function provenanceRows(ctx) {
    var d = new Date();
    return [
      ["Company", ctx.company || ""],
      ["Page", ctx.page || document.title],
      ["Generated", d.toISOString().slice(0, 19).replace("T", " ") + " UTC"],
      ["Source", ctx.source || ""],
      [""],
    ];
  }

  function download(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function safe(s) { return String(s || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, ""); }

  /* ---------- public ---------- */
  window.RTExport = {
    /** Every table under `root` (or a list of tables) → one workbook. */
    xlsx: function (tables, ctx) {
      var list = Array.isArray(tables) ? tables : Array.prototype.slice.call(tables);
      var sheets = [];
      list.forEach(function (t, i) {
        var rows = tableRows(t);
        if (!rows.length) return;
        var name = (t.getAttribute("data-export-name") ||
          (t.closest("section") && t.closest("section").querySelector("h2, h3") || {}).textContent || ("Table " + (i + 1)))
          .replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31);
        sheets.push({ name: name, rows: provenanceRows(ctx).concat(rows) });
      });
      if (!sheets.length) return false;
      download(workbook(sheets), safe(ctx.company) + "-" + safe(ctx.page) + "-" + stamp() + ".xlsx");
      return true;
    },
    csv: function (table, ctx) {
      var rows = provenanceRows(ctx).concat(tableRows(table));
      var text = rows.map(function (r) {
        return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
      }).join("\r\n");
      download(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }),
        safe(ctx.company) + "-" + safe((table.getAttribute("data-export-name") || "table")) + "-" + stamp() + ".csv");
    },
    /** The page as the browser prints it, with a dated provenance banner. */
    print: function (ctx) {
      var banner = document.getElementById("print-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "print-banner";
        document.body.insertBefore(banner, document.body.firstChild);
      }
      banner.textContent = (ctx.company ? ctx.company + " — " : "") + (ctx.page || document.title) +
        " — snapshot " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" +
        (ctx.source ? " — " + ctx.source : "");
      window.print();
    },
  };
})();
