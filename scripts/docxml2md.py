#!/usr/bin/env python3
"""Convert a Claude Docs read result (JSON with data.xml) into a content/2026 part file.

Usage: python3 scripts/docxml2md.py <read-result.json> <part> <as_of YYYY-MM-DD> <out.md>
"""
import json
import sys
import xml.etree.ElementTree as ET


def inline(el) -> str:
    out = []
    if el.text:
        out.append(el.text)
    for child in el:
        inner = inline(child)
        if child.tag == "bold":
            out.append(f"**{inner}**")
        elif child.tag == "link":
            out.append(f"[{inner}]({child.get('href')})")
        elif child.tag in ("text",):
            out.append(inner)
        # date, mention and anything else are dropped
        if child.tail:
            out.append(child.tail)
    return "".join(out)


def main():
    src, part, as_of, dest = sys.argv[1:5]
    raw = json.load(open(src))
    if isinstance(raw, list):  # persisted MCP output: [{"type":"text","text":"<json>"}]
        raw = json.loads(raw[0]["text"])
    xml = raw["data"]["xml"] if "data" in raw else raw["xml"]
    root = ET.fromstring(xml)
    title, blocks = None, []
    for p in root.iter("paragraph"):
        text = " ".join(inline(p).split())
        level = p.get("heading")
        if level == "1" and title is None:
            title = text
            continue
        if not text or text == "·":
            continue
        blocks.append(("#" * int(level) + " " + text) if level else text)
    head = f'---\npart: {part}\ntitle: "{title}"\nas_of: {as_of}\n---\n\n'
    with open(dest, "w") as fh:
        fh.write(head + "\n\n".join(blocks) + "\n")
    print(f"{dest}: {len(blocks)} blocks, title={title!r}")


if __name__ == "__main__":
    main()
