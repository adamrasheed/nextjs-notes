import { getSchema, type JSONContent } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Node } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";

// One extension list shared by the client editor, server validation and the share page renderer.
// Links are off: no href attributes means no javascript: URLs to sanitize.
export const extensions = [StarterKit.configure({ link: false }), TaskList, TaskItem.configure({ nested: true })];

const schema = getSchema(extensions);

export type ParsedDoc = { content: JSONContent; text: string };

// Validates untrusted JSON against the editor schema. Unknown node or mark types throw,
// unknown attributes are dropped, and plain text is extracted for snippets and search.
export function parseDoc(json: unknown): ParsedDoc {
  const doc = Node.fromJSON(schema, json);
  if (doc.type.name !== "doc") throw new Error("root node must be doc");
  doc.check();
  return { content: doc.toJSON(), text: doc.textBetween(0, doc.content.size, "\n", " ") };
}
