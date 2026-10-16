import { onRequestPost as __api_cache_js_onRequestPost } from "/home/user/spotivinyl/functions/api/cache.js"
import { onRequestPut as __api_cache_js_onRequestPut } from "/home/user/spotivinyl/functions/api/cache.js"
import { onRequestGet as __api_me_js_onRequestGet } from "/home/user/spotivinyl/functions/api/me.js"
import { onRequestGet as __api_search_js_onRequestGet } from "/home/user/spotivinyl/functions/api/search.js"
import { onRequestGet as __api_sign_js_onRequestGet } from "/home/user/spotivinyl/functions/api/sign.js"
import { onRequestGet as __auth_callback_js_onRequestGet } from "/home/user/spotivinyl/functions/auth/callback.js"
import { onRequestGet as __auth_login_js_onRequestGet } from "/home/user/spotivinyl/functions/auth/login.js"
import { onRequestPost as __auth_logout_js_onRequestPost } from "/home/user/spotivinyl/functions/auth/logout.js"

export const routes = [
    {
      routePath: "/api/cache",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_cache_js_onRequestPost],
    },
  {
      routePath: "/api/cache",
      mountPath: "/api",
      method: "PUT",
      middlewares: [],
      modules: [__api_cache_js_onRequestPut],
    },
  {
      routePath: "/api/me",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_me_js_onRequestGet],
    },
  {
      routePath: "/api/search",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_search_js_onRequestGet],
    },
  {
      routePath: "/api/sign",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_sign_js_onRequestGet],
    },
  {
      routePath: "/auth/callback",
      mountPath: "/auth",
      method: "GET",
      middlewares: [],
      modules: [__auth_callback_js_onRequestGet],
    },
  {
      routePath: "/auth/login",
      mountPath: "/auth",
      method: "GET",
      middlewares: [],
      modules: [__auth_login_js_onRequestGet],
    },
  {
      routePath: "/auth/logout",
      mountPath: "/auth",
      method: "POST",
      middlewares: [],
      modules: [__auth_logout_js_onRequestPost],
    },
  ]