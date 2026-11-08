import { onRequestGet as __api_checkout_js_onRequestGet } from "/home/claude/sweet-pea-temp/functions/api/checkout.js"
import { onRequestPost as __api_checkout_js_onRequestPost } from "/home/claude/sweet-pea-temp/functions/api/checkout.js"

export const routes = [
    {
      routePath: "/api/checkout",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_checkout_js_onRequestGet],
    },
  {
      routePath: "/api/checkout",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_checkout_js_onRequestPost],
    },
  ]