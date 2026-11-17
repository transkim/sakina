import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Let Quran recitation keep playing when Sakina is in the background or the screen is locked
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// MARK: - Offline Quran recitation

/// Registers Sakina's own plugins (the storyboard uses this class instead of CAPBridgeViewController).
class SakinaViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(QuranAudioPlugin())
    }
}

/// Saves Quran recitation files on the iPhone so they play without internet.
@objc(QuranAudioPlugin)
public class QuranAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QuranAudioPlugin"
    public let jsName = "QuranAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]
    private var cancelled = false
    private let lock = NSLock()

    private var root: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("quran", isDirectory: true)
    }
    private func safe(_ s: String?) -> Bool { guard let s = s, !s.isEmpty else { return false }; return !s.contains("/") && !s.contains("..") }

    @objc func list(_ call: CAPPluginCall) {
        let reciter = call.getString("reciter")
        var files: [String] = []
        var bytes: Int64 = 0
        if safe(reciter), let names = try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(reciter!).path) {
            for n in names where n.hasSuffix(".mp3") {
                let p = root.appendingPathComponent(reciter!).appendingPathComponent(n).path
                let attrs = (try? FileManager.default.attributesOfItem(atPath: p)) ?? [:]
                let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
                if size > 0 { files.append(n); bytes += size }
            }
        }
        call.resolve(["dir": root.path, "files": files, "bytes": bytes])
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let reciter = call.getString("reciter"), safe(reciter) else { call.reject("bad reciter"); return }
        let items = call.getArray("items") as? [[String: Any]] ?? []
        let dir = root.appendingPathComponent(reciter, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // keep the files out of iCloud backups
        var rv = URLResourceValues(); rv.isExcludedFromBackup = true
        var d = root; try? d.setResourceValues(rv)
        cancelled = false
        let total = items.count
        var done = 0, failed = 0
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 4
        for it in items {
            queue.addOperation { [weak self] in
                guard let self = self else { return }
                if self.cancelled { return }
                let name = it["name"] as? String
                var ok = false
                if self.safe(name) {
                    let out = dir.appendingPathComponent(name!)
                    ok = FileManager.default.fileExists(atPath: out.path)
                    if !ok, let u = it["url"] as? String { ok = self.fetch(u, to: out) }
                    if !ok, let a = it["alt"] as? String { ok = self.fetch(a, to: out) }
                }
                self.lock.lock()
                done += 1; if !ok { failed += 1 }
                let snapshot: [String: Any] = ["reciter": reciter, "done": done, "total": total, "failed": failed]
                self.lock.unlock()
                self.notifyListeners("progress", data: snapshot)
            }
        }
        DispatchQueue.global(qos: .utility).async {
            queue.waitUntilAllOperationsAreFinished()
            call.resolve(["done": done, "failed": failed, "cancelled": self.cancelled])
        }
    }

    private func fetch(_ urlString: String, to out: URL) -> Bool {
        guard urlString.hasPrefix("https://"), let url = URL(string: urlString) else { return false }
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        var req = URLRequest(url: url); req.timeoutInterval = 30
        URLSession.shared.downloadTask(with: req) { tmp, resp, _ in
            if let tmp = tmp, (resp as? HTTPURLResponse)?.statusCode == 200 {
                try? FileManager.default.removeItem(at: out)
                ok = (try? FileManager.default.moveItem(at: tmp, to: out)) != nil
            }
            sem.signal()
        }.resume()
        sem.wait()
        return ok
    }

    @objc func cancel(_ call: CAPPluginCall) { cancelled = true; call.resolve() }

    @objc func remove(_ call: CAPPluginCall) {
        guard let reciter = call.getString("reciter"), safe(reciter) else { call.reject("bad reciter"); return }
        let dir = root.appendingPathComponent(reciter, isDirectory: true)
        if let names = call.getArray("names") as? [String] {
            for n in names where safe(n) { try? FileManager.default.removeItem(at: dir.appendingPathComponent(n)) }
        } else {
            try? FileManager.default.removeItem(at: dir)
        }
        call.resolve()
    }
}
