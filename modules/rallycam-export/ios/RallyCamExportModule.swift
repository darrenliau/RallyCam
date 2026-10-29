import ExpoModulesCore

/// JavaScript side: modules/rallycam-export/src/index.ts
public class RallyCamExportModule: Module {
  private var exporter: OverlayExporter?

  public func definition() -> ModuleDefinition {
    Name("RallyCamExport")

    Events("onProgress")

    // exportWithOverlay(videoUri, sceneUri, outUri, fps) -> output file uri
    // fps 0 keeps the video's own frame rate. The scene file is the JSON written by src/export/nativeExport.ts.
    AsyncFunction("exportWithOverlay") { (videoUri: String, sceneUri: String, outUri: String, fps: Double, promise: Promise) in
      let exporter = OverlayExporter()
      self.exporter = exporter

      var lastSent = 0.0
      exporter.run(
        videoURL: RallyCamExportModule.url(from: videoUri),
        sceneURL: RallyCamExportModule.url(from: sceneUri),
        outURL: RallyCamExportModule.url(from: outUri),
        fps: fps,
        progress: { [weak self] value in
          // about 20 updates over the whole export is plenty
          if value - lastSent >= 0.05 || value >= 1 {
            lastSent = value
            DispatchQueue.main.async {
              self?.sendEvent("onProgress", ["progress": value])
            }
          }
        },
        completion: { [weak self] result in
          self?.exporter = nil
          switch result {
          case .success(let url):
            promise.resolve(url.absoluteString)
          case .failure(let error):
            let code = (error as? ExportError)?.isCancelled == true ? "ERR_CANCELLED" : "ERR_EXPORT"
            promise.reject(code, error.localizedDescription)
          }
        }
      )
    }

    Function("cancelExport") {
      self.exporter?.cancel()
    }
  }

  /// Accepts both "file:///..." and plain paths.
  private static func url(from string: String) -> URL {
    if let url = URL(string: string), url.scheme != nil { return url }
    return URL(fileURLWithPath: string)
  }
}
