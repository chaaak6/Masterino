import Cocoa
import CryptoKit

// A small, independent installation window; survives the old Electron process.
struct Request: Decodable {
    let installer: String
    let target: String
    let parent: Int32
    let sha512: String
    let version: String
}

final class UpdateWindow: NSObject, NSApplicationDelegate {
    let request: Request
    let directory: URL
    let fm = FileManager.default
    var window: NSWindow!
    let label = NSTextField(labelWithString: "正在结束 Masterino… / Closing Masterino…")
    let progress = NSProgressIndicator()
    var mounted: String?
    var backup: URL?
    var staged: URL?
    var replaced = false

    init(_ request: Request, _ directory: URL) { self.request = request; self.directory = directory }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 155),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Masterino 更新 / Update"
        label.frame = NSRect(x: 24, y: 85, width: 432, height: 40)
        label.maximumNumberOfLines = 2
        progress.frame = NSRect(x: 24, y: 55, width: 432, height: 18)
        progress.style = .bar; progress.isIndeterminate = true; progress.startAnimation(nil)
        window.contentView?.addSubview(label); window.contentView?.addSubview(progress)
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        try? Data("ready".utf8).write(to: directory.appendingPathComponent("ready"), options: .atomic)
        DispatchQueue.global(qos: .userInitiated).async { self.install() }
    }

    func state(_ text: String, fraction: Double? = nil) {
        DispatchQueue.main.async {
            self.label.stringValue = text
            self.progress.isIndeterminate = fraction == nil
            if let value = fraction { self.progress.maxValue = 1; self.progress.doubleValue = min(1, value) }
            else { self.progress.startAnimation(nil) }
        }
        try? Data(text.utf8).write(to: directory.appendingPathComponent("status.txt"), options: .atomic)
    }

    @discardableResult func run(_ executable: String, _ args: [String]) throws -> Data {
        let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = args
        let output = Pipe(); process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        if process.terminationStatus != 0 { throw NSError(domain: "MasterinoUpdate", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "操作失败 / Operation failed: \(URL(fileURLWithPath: executable).lastPathComponent)"]) }
        return data
    }

    func bytes(_ root: URL) -> Int64 {
        guard let iterator = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]) else { return 0 }
        var total: Int64 = 0
        for case let file as URL in iterator {
            if let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]), values.isRegularFile == true {
                total += Int64(values.fileSize ?? 0)
            }
        }
        return total
    }

    func install() {
        let target = URL(fileURLWithPath: request.target)
        do {
            guard request.parent > 1, target.pathExtension == "app", fm.fileExists(atPath: target.path) else {
                throw NSError(domain: "MasterinoUpdate", code: 2, userInfo: [NSLocalizedDescriptionKey: "找不到原应用 / Original App missing"])
            }
            // This helper is launched only after managed task cleanup succeeds.
            // Electron can still hang in Node filesystem teardown after its windows close.
            let waitUntil = Date().addingTimeInterval(30)
            while kill(request.parent, 0) == 0 {
                if Date() > waitUntil {
                    guard let parent = NSRunningApplication(processIdentifier: request.parent),
                          parent.bundleURL?.resolvingSymlinksInPath() == target.resolvingSymlinksInPath() else {
                        throw NSError(domain: "MasterinoUpdate", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法确认原应用进程 / Cannot identify the previous App process"])
                    }
                    state("正在结束旧版后台进程… / Closing previous App process…")
                    kill(request.parent, SIGTERM)
                    let gracefulDeadline = Date().addingTimeInterval(5)
                    while kill(request.parent, 0) == 0 && Date() < gracefulDeadline { Thread.sleep(forTimeInterval: 0.1) }
                    if kill(request.parent, 0) == 0 { parent.forceTerminate() }
                    let forcedDeadline = Date().addingTimeInterval(5)
                    while kill(request.parent, 0) == 0 && Date() < forcedDeadline { Thread.sleep(forTimeInterval: 0.1) }
                    guard kill(request.parent, 0) != 0 else {
                        throw NSError(domain: "MasterinoUpdate", code: 3, userInfo: [NSLocalizedDescriptionKey: "原应用尚未退出 / Original App is still running"])
                    }
                    break
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            state("正在校验安装包… / Verifying update…")
            let stream = try FileHandle(forReadingFrom: URL(fileURLWithPath: request.installer)); defer { try? stream.close() }
            var hash = SHA512()
            while let chunk = try stream.read(upToCount: 1024 * 1024), !chunk.isEmpty { hash.update(data: chunk) }
            guard Data(hash.finalize()).base64EncodedString() == request.sha512 else {
                throw NSError(domain: "MasterinoUpdate", code: 4, userInfo: [NSLocalizedDescriptionKey: "安装包校验失败 / Update checksum mismatch"])
            }
            state("正在准备安装… / Preparing installation…")
            let plist = try run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-plist", request.installer])
            let parsed = try PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any]
            mounted = (parsed?["system-entities"] as? [[String: Any]])?.compactMap { $0["mount-point"] as? String }.first
            guard let mount = mounted else { throw NSError(domain: "MasterinoUpdate", code: 5) }
            let candidates = try fm.contentsOfDirectory(at: URL(fileURLWithPath: mount), includingPropertiesForKeys: nil).filter { $0.pathExtension == "app" }
            guard candidates.count == 1, let source = candidates.first,
                  let info = NSDictionary(contentsOf: source.appendingPathComponent("Contents/Info.plist")),
                  let oldInfo = NSDictionary(contentsOf: target.appendingPathComponent("Contents/Info.plist")),
                  info["CFBundleIdentifier"] as? String == oldInfo["CFBundleIdentifier"] as? String,
                  info["CFBundleShortVersionString"] as? String == request.version else {
                throw NSError(domain: "MasterinoUpdate", code: 6, userInfo: [NSLocalizedDescriptionKey: "安装包身份或版本不匹配 / App identity or version mismatch"])
            }
            // Electron resolves helpers using the original product name, then CFBundleName.
            // Validate those exact executable paths before replacing a working App.
            guard let executable = info["CFBundleExecutable"] as? String,
                  fm.isExecutableFile(atPath: source.appendingPathComponent("Contents/MacOS/\(executable)").path),
                  fm.fileExists(atPath: source.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path) else {
                throw NSError(domain: "MasterinoUpdate", code: 9, userInfo: [NSLocalizedDescriptionKey: "应用运行时不完整 / App runtime is incomplete"])
            }
            let names = ["Electron", info["CFBundleName"] as? String ?? ""]
            for suffix in ["", " (Renderer)", " (GPU)"] {
                guard names.contains(where: { name in
                    let helper = "\(name) Helper\(suffix)"
                    return fm.isExecutableFile(atPath: source.appendingPathComponent("Contents/Frameworks/\(helper).app/Contents/MacOS/\(helper)").path)
                }) else {
                    throw NSError(domain: "MasterinoUpdate", code: 10, userInfo: [NSLocalizedDescriptionKey: "安装包的 Electron Helper 不匹配 / Electron Helper mismatch: \(suffix)"])
                }
            }
            let stage = target.deletingLastPathComponent().appendingPathComponent(".masterino-stage-\(UUID().uuidString).app")
            staged = stage
            let total = max(1, bytes(source))
            let copy = Process(); copy.executableURL = URL(fileURLWithPath: "/usr/bin/ditto"); copy.arguments = [source.path, stage.path]
            copy.standardOutput = FileHandle.nullDevice; copy.standardError = FileHandle.nullDevice
            try copy.run()
            while copy.isRunning {
                let fraction = Double(bytes(stage)) / Double(total)
                state("正在复制应用… / Copying App… \(Int(min(1, fraction) * 100))%", fraction: fraction)
                Thread.sleep(forTimeInterval: 0.4)
            }
            guard copy.terminationStatus == 0 else { throw NSError(domain: "MasterinoUpdate", code: 7) }
            state("正在检查应用… / Checking App…")
            try run("/usr/bin/codesign", ["--verify", "--deep", stage.path])
            let previous = target.deletingLastPathComponent().appendingPathComponent(".masterino-previous-\(UUID().uuidString).app")
            backup = previous
            try fm.moveItem(at: target, to: previous)
            do { try fm.moveItem(at: stage, to: target); replaced = true }
            catch { try fm.moveItem(at: previous, to: target); backup = nil; throw error }
            state("正在启动新版… / Starting new version…")
            try run("/usr/bin/open", ["-n", target.path, "--args", "--masterino-update-receipt", directory.path])
            let launchDeadline = Date().addingTimeInterval(120)
            while !fm.fileExists(atPath: directory.appendingPathComponent("started").path) {
                if Date() > launchDeadline { throw NSError(domain: "MasterinoUpdate", code: 8, userInfo: [NSLocalizedDescriptionKey: "新版启动未完成 / New App did not finish startup"]) }
                Thread.sleep(forTimeInterval: 0.25)
            }
            try? fm.removeItem(at: previous); backup = nil
            state("更新完成 / Update complete", fraction: 1)
            try? Data("success".utf8).write(to: directory.appendingPathComponent("result"), options: .atomic)
            finish()
        } catch {
            // Only restore the exact App this job replaced; userData is never touched.
            var recovery = "原应用已保留 / Previous App retained"
            if replaced, let previous = backup {
                let running = NSWorkspace.shared.runningApplications.filter { $0.bundleURL?.path == target.path }
                running.forEach { $0.forceTerminate() }
                Thread.sleep(forTimeInterval: 1)
                do {
                    try fm.removeItem(at: target)
                    try fm.moveItem(at: previous, to: target)
                } catch {
                    recovery = "请从此路径恢复原应用 / Restore the previous App from: \(previous.path)"
                }
            }
            if let stage = staged { try? fm.removeItem(at: stage) }
            try? run("/usr/bin/open", ["-n", target.path])
            let message = "更新未完成 / Update failed.\n\(recovery)\n\(error.localizedDescription)"
            state(message)
            try? Data(message.utf8).write(to: directory.appendingPathComponent("result"), options: .atomic)
            DispatchQueue.main.async {
                let alert = NSAlert(); alert.messageText = "Masterino 更新未完成 / Update failed"; alert.informativeText = message
                alert.runModal(); self.finish()
            }
        }
    }

    func finish() {
        if let mount = mounted { try? run("/usr/bin/hdiutil", ["detach", mount]) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) }
    }
}

guard CommandLine.arguments.count == 2 else { exit(2) }
let job = URL(fileURLWithPath: CommandLine.arguments[1])
let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: job))
let delegate = UpdateWindow(request, job.deletingLastPathComponent())
let application = NSApplication.shared
application.setActivationPolicy(.regular); application.delegate = delegate; application.run()
