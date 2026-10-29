import AVFoundation
import ExpoModulesCore
import UIKit

/// Camera preview. The camera itself is owned by CaptureController, so the view only displays its session.
public class RallyCamCapturePreview: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    previewLayer.session = CaptureController.shared.session
    previewLayer.videoGravity = .resizeAspectFill   // fills the screen, like the overlay's "cover" maths assumes
    layer.addSublayer(previewLayer)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    if let connection = previewLayer.connection, connection.isVideoOrientationSupported {
      connection.videoOrientation = CaptureController.currentVideoOrientation()
    }
    CaptureController.shared.refreshOrientation()
  }
}

/// JavaScript side: modules/rallycam-export/src/capture.ts
public class RallyCamCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RallyCamCapture")

    Events("onDetections", "onError", "onInterruption", "onPressure")

    OnCreate {
      let controller = CaptureController.shared
      controller.onDetections = { [weak self] boxes in
        DispatchQueue.main.async { self?.sendEvent("onDetections", ["boxes": boxes]) }
      }
      controller.onError = { [weak self] message in
        DispatchQueue.main.async { self?.sendEvent("onError", ["message": message]) }
      }
      controller.onInterruption = { [weak self] interrupted, reason in
        DispatchQueue.main.async { self?.sendEvent("onInterruption", ["interrupted": interrupted, "reason": reason]) }
      }
      controller.onPressure = { [weak self] level in
        DispatchQueue.main.async { self?.sendEvent("onPressure", ["level": level]) }
      }
    }

    // Starts the camera. Resolves with the frame rate and size it really settled on.
    AsyncFunction("startSession") { (targetFps: Int, promise: Promise) in
      CaptureController.shared.start(targetFps: targetFps) { result in
        switch result {
        case .success(let info):
          promise.resolve(["fps": info.fps, "width": info.width, "height": info.height])
        case .failure(let error):
          promise.reject("ERR_CAPTURE", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopSession") { (promise: Promise) in
      CaptureController.shared.stop { promise.resolve(nil) }
    }

    // Starts writing a video at the next frame. The file has outputFps frames per second, is width x height, and about bitRate bits per second.
    Function("startRecording") { (uri: String, outputFps: Double, width: Int, height: Int, bitRate: Int) in
      let url = URL(string: uri).flatMap { $0.scheme != nil ? $0 : nil } ?? URL(fileURLWithPath: uri)
      CaptureController.shared.startRecording(url: url, outputFps: outputFps, width: width, height: height, bitRate: bitRate)
    }

    // Resolves with the finished file's uri, overlay included.
    AsyncFunction("stopRecording") { (promise: Promise) in
      CaptureController.shared.stopRecording { url, error in
        if let error {
          promise.reject("ERR_RECORDING", error.localizedDescription)
        } else {
          promise.resolve(url?.absoluteString)
        }
      }
    }

    // The overlay to draw on every frame from now on (a scene file as JSON, see src/export/ass.ts buildLiveScene).
    Function("setOverlay") { (json: String) in
      CaptureController.shared.setOverlay(json: json)
    }

    // Counters for the on-screen diagnostics: pushes, decoded, failed, framesWritten, framesWithOverlay, lastProblem.
    Function("getStatus") { () -> [String: Any] in
      CaptureController.shared.status()
    }

    // Court area to look for people in, as fractions of the frame. enabled false turns detection off.
    Function("setDetection") { (enabled: Bool, x: Double, y: Double, w: Double, h: Double) in
      CaptureController.shared.setDetection(roi: enabled ? CGRect(x: x, y: y, width: w, height: h) : nil)
    }

    View(RallyCamCapturePreview.self) {}
  }
}
