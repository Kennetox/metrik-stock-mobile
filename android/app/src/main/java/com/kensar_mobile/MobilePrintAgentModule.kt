package com.kensar_mobile

import android.content.Context
import android.os.Build
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MobilePrintAgentModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "MobilePrintAgent"

  @ReactMethod
  fun discoverPrinters(prefixes: ReadableArray, port: Int, timeoutMs: Int, promise: Promise) {
    val safePort = if (port in 1..65535) port else 8081
    val safeTimeout = timeoutMs.coerceIn(80, 3000)

    val prefixList = mutableListOf<String>()
    for (i in 0 until prefixes.size()) {
      val value = prefixes.getString(i)?.trim() ?: continue
      if (value.matches(Regex("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"))) {
        prefixList.add(value)
      }
    }

    if (prefixList.isEmpty()) {
      val empty = Arguments.createMap().apply {
        putArray("urls", Arguments.createArray())
        putInt("count", 0)
      }
      promise.resolve(empty)
      return
    }

    Thread {
      try {
        val executor = Executors.newFixedThreadPool(36)
        val tasks = mutableListOf<Callable<String?>>()

        for (prefix in prefixList.distinct()) {
          for (host in 1..254) {
            val ip = "$prefix.$host"
            tasks.add(Callable {
              val socket = Socket()
              try {
                socket.connect(InetSocketAddress(ip, safePort), safeTimeout)
                "http://$ip:$safePort"
              } catch (_: Exception) {
                null
              } finally {
                try {
                  socket.close()
                } catch (_: Exception) {
                }
              }
            })
          }
        }

        val futures = executor.invokeAll(tasks)
        executor.shutdown()
        executor.awaitTermination(5, TimeUnit.SECONDS)

        val urls = futures
          .mapNotNull { future ->
            try {
              future.get()
            } catch (_: Exception) {
              null
            }
          }
          .distinct()
          .sorted()

        val arr = Arguments.createArray()
        urls.forEach { arr.pushString(it) }

        val response = Arguments.createMap().apply {
          putArray("urls", arr)
          putInt("count", urls.size)
        }
        promise.resolve(response)
      } catch (e: Exception) {
        promise.reject("DISCOVER_FAILED", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun checkEndpoint(urlValue: String, timeoutMs: Int, promise: Promise) {
    Thread {
      val timeout = timeoutMs.coerceIn(200, 5000)
      val normalized = normalizeUrl(urlValue)
      if (normalized.isEmpty()) {
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", false)
          putInt("status", 0)
        })
        return@Thread
      }

      val base = try {
        URL(normalized)
      } catch (_: Exception) {
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", false)
          putInt("status", 0)
        })
        return@Thread
      }

      val targets = mutableListOf(normalized)
      if (base.path.let { it == "/" || it.isEmpty() }) {
        val noSlash = normalized.trimEnd('/')
        targets.add("$noSlash/print")
        targets.add("$noSlash/api/print")
        targets.add("$noSlash/labels/print")
      }

      for (target in targets.distinct()) {
        try {
          val conn = (URL(target).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = timeout
            readTimeout = timeout
            instanceFollowRedirects = true
          }
          val status = conn.responseCode
          if (status in 200..499) {
            promise.resolve(Arguments.createMap().apply {
              putBoolean("ok", true)
              putInt("status", status)
            })
            return@Thread
          }
        } catch (_: Exception) {
          // probamos siguiente target
        }
      }

      // fallback de conectividad real: si el puerto abre, la impresora está alcanzable
      val port = if (base.port > 0) base.port else 80
      val socket = Socket()
      try {
        socket.connect(InetSocketAddress(base.host, port), timeout)
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putInt("status", 0)
        })
        return@Thread
      } catch (_: Exception) {
      } finally {
        try {
          socket.close()
        } catch (_: Exception) {
        }
      }

      promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", false)
        putInt("status", 0)
      })
    }.start()
  }

  @ReactMethod
  fun print(urlValue: String, payloadJson: String, timeoutMs: Int, promise: Promise) {
    Thread {
      val timeout = timeoutMs.coerceIn(500, 8000)
      try {
        val base = normalizeUrl(urlValue)
        if (base.isEmpty()) {
          promise.reject("INVALID_URL", "URL de impresora inválida")
          return@Thread
        }

        val targets = mutableListOf(base)
        if (URL(base).path.let { it == "/" || it.isEmpty() }) {
          val noSlash = base.trimEnd('/')
          targets.add("$noSlash/print")
          targets.add("$noSlash/api/print")
          targets.add("$noSlash/labels/print")
        }

        var lastStatus = 0
        var lastBody = ""

        for (target in targets.distinct()) {
          val result = postJson(target, payloadJson, timeout)
          lastStatus = result.first
          lastBody = result.second

          if (lastStatus in 200..299) {
            val map = Arguments.createMap().apply {
              putBoolean("ok", true)
              putString("target", target)
              putInt("status", lastStatus)
            }
            promise.resolve(map)
            return@Thread
          }

          if (lastBody.lowercase().contains("cannot post")) {
            continue
          }
        }

        promise.reject(
          "PRINT_FAILED",
          if (lastBody.isNotBlank()) "Error $lastStatus: ${stripHtml(lastBody)}" else "Error $lastStatus"
        )
      } catch (e: Exception) {
        promise.reject("PRINT_EXCEPTION", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun printHtml(title: String, html: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "No hay actividad activa para abrir impresión.")
      return
    }

    activity.runOnUiThread {
      try {
        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = false
        webView.settings.domStorageEnabled = false
        webView.webViewClient = object : WebViewClient() {
          override fun onPageFinished(view: WebView?, url: String?) {
            try {
              val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
              val safeTitle = if (title.trim().isNotEmpty()) title.trim() else "SOP Metrik Stock"
              val adapter = webView.createPrintDocumentAdapter(safeTitle)
              printManager.print(
                safeTitle,
                adapter,
                PrintAttributes.Builder().build()
              )
              promise.resolve(true)
            } catch (e: Exception) {
              promise.reject("PRINT_HTML_FAILED", e.message, e)
            }
          }
        }
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
      } catch (e: Exception) {
        promise.reject("PRINT_HTML_EXCEPTION", e.message, e)
      }
    }
  }

  @ReactMethod
  fun getAppInfo(promise: Promise) {
    try {
      val context = reactApplicationContext
      val packageName = context.packageName
      val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(
          packageName,
          android.content.pm.PackageManager.PackageInfoFlags.of(0)
        )
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(packageName, 0)
      }

      val versionName = packageInfo.versionName ?: "0.0.0"
      val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        packageInfo.longVersionCode.toString()
      } else {
        @Suppress("DEPRECATION")
        packageInfo.versionCode.toString()
      }

      val map = Arguments.createMap().apply {
        putString("versionName", versionName)
        putString("versionCode", versionCode)
        putString("packageName", packageName)
      }
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("APP_INFO_FAILED", e.message, e)
    }
  }

  private fun normalizeUrl(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ""
    return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed else "http://$trimmed"
  }

  private fun postJson(target: String, body: String, timeoutMs: Int): Pair<Int, String> {
    val conn = (URL(target).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = timeoutMs
      readTimeout = timeoutMs
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Accept", "application/json,text/plain,*/*")
    }

    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
      writer.write(body)
      writer.flush()
    }

    val status = conn.responseCode
    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
    val responseText = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""

    return status to responseText
  }

  private fun stripHtml(input: String): String {
    return input.replace(Regex("<[^>]*>"), " ").replace(Regex("\\s+"), " ").trim()
  }
}
