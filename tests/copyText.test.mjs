import assert from "node:assert/strict";
import test from "node:test";

const { copyText } = await import("../lib/client/copyText.ts");

test("copyText uses the exact Clipboard payload then falls back to a selected textarea", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const htmlElementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");

  try {
    let clipboardPayload = "";
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          async writeText(value) {
            clipboardPayload = value;
          }
        }
      }
    });
    await copyText("서울특별시 동대문구 장안동 373-3");
    assert.equal(clipboardPayload, "서울특별시 동대문구 장안동 373-3");

    class FakeHTMLElement {
      focusOptions = [];

      focus(options) {
        this.focusOptions.push(options);
      }
    }
    const activeElement = new FakeHTMLElement();
    const textarea = new FakeHTMLElement();
    Object.assign(textarea, {
      value: "",
      readOnly: false,
      style: {},
      attributes: new Map(),
      selected: false,
      selectionRange: null,
      removed: false,
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      select() {
        this.selected = true;
      },
      setSelectionRange(start, end) {
        this.selectionRange = [start, end];
      },
      remove() {
        this.removed = true;
      }
    });
    let appendedElement = null;
    let executedCommand = "";
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: FakeHTMLElement
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          async writeText() {
            throw new Error("WebView clipboard denied");
          }
        }
      }
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        activeElement,
        body: {
          appendChild(element) {
            appendedElement = element;
          }
        },
        createElement(tagName) {
          assert.equal(tagName, "textarea");
          return textarea;
        },
        execCommand(command) {
          executedCommand = command;
          return true;
        }
      }
    });

    await copyText("두 줄이어도 전체 canonical 주소");
    assert.equal(appendedElement, textarea);
    assert.equal(textarea.value, "두 줄이어도 전체 canonical 주소");
    assert.equal(textarea.readOnly, true);
    assert.equal(textarea.attributes.get("aria-hidden"), "true");
    assert.equal(textarea.selected, true);
    assert.deepEqual(textarea.selectionRange, [0, textarea.value.length]);
    assert.equal(executedCommand, "copy");
    assert.equal(textarea.removed, true);
    assert.deepEqual(activeElement.focusOptions, [{ preventScroll: true }]);
  } finally {
    restoreProperty("navigator", navigatorDescriptor);
    restoreProperty("document", documentDescriptor);
    restoreProperty("HTMLElement", htmlElementDescriptor);
  }
});

function restoreProperty(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
