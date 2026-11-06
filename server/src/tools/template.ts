import { z } from "zod";
import { template } from "@jagentchill/editor-core";
import { WRITE, fail, writeTool, type ToolContext } from "./kit.ts";

export const TEMPLATE_TOOLS = [
  writeTool({
    name: "jc_template_edit", family: "template",
    description: "Fill typed variables on a template draft in one edit. Pass variable ids with text, hex colour, image asset id, or number values; all bound properties update together in one undo step.",
    shape: { variables: z.record(z.union([z.string().max(10_000), z.number().finite()])), ...WRITE },
    refine(args) { if (Object.keys(args.variables).length === 0) fail("INVALID_PARAMS", "Pass at least one variable value.", { field: "variables" }); },
    handle(ctx: ToolContext, args) {
      const sceneId = ctx.doc.template?.sceneId ?? ctx.activeSceneId();
      ctx.apply((doc, commitContext) => template.fillTemplateVariables(doc, commitContext, args.variables));
      return { data: { variables: Object.keys(args.variables) }, summary: `Filled ${Object.keys(args.variables).length} template variable(s).`, change: { kind: "modify", entity: "scene", entityId: sceneId, label: "Template" } };
    },
  }),
];
