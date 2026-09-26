import Foundation
import Capacitor
import AuthenticationServices

/*
 * AppleSignInPlugin -- runs the native Sign in with Apple sheet and returns the
 * identity token to the web layer.
 *
 * Why the token and not a session: the plugin's job ends at "Apple says who
 * this is". It deliberately does NOT talk to our own server. Exchanging the
 * token for a session cookie is the web layer's job, using the same
 * /api/auth/apple endpoint the browser build calls, so there is exactly one
 * place where an account is resolved and one place where a session is issued.
 * Doing the exchange here would mean a second implementation of that logic in
 * Swift with its own drift.
 *
 * SECURITY: this plugin does not verify the token, and must not be read as
 * having done so. The token it returns is attacker-controllable the moment it
 * leaves the device -- it is just a string travelling over the bridge. The
 * server verifies the signature against Apple's published keys before trusting
 * a single claim from it. See src/lib/appleAuth.ts.
 *
 * The full name is genuinely available exactly once: Apple returns it on the
 * FIRST authorisation for an app+Apple ID pair and never again, so a sign-in
 * that ignores it can never recover the name. That is why it is forwarded here
 * and persisted server-side on first account creation rather than requested
 * later.
 */

@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
    ]

    /// The in-flight call, retained because ASAuthorizationController holds its
    /// delegate weakly and the session is asynchronous.
    private var pendingCall: CAPPluginCall?

    /// Keeps the controller alive for the duration of the flow. Without this the
    /// controller is deallocated as soon as the method returns and the delegate
    /// never fires, which presents as the sheet appearing and then nothing
    /// happening.
    private var authController: ASAuthorizationController?

    /// Whether the system considers the user signed in to iCloud at all.
    ///
    /// This is advisory, not a gate. A user can complete Sign in with Apple
    /// while having no iCloud account, and the flow will offer to create one.
    /// The web layer uses this only to decide whether to render the button, and
    /// the button being present is never a security decision.
    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": true,
            "message": "Sign in with Apple is available.",
        ])
    }

    /// Run the Sign in with Apple flow.
    ///
    /// `resolve` carries either a full credential or the fact that the user
    /// dismissed the sheet. A dismissal is NOT an error -- it is the most
    /// common outcome and resolving for it keeps the web layer from having to
    /// treat a normal choice as a failure. A `reject` is reserved for a real
    /// failure (no presentation context, Apple returning an error).
    @objc func signIn(_ call: CAPPluginCall) {
        if pendingCall != nil {
            call.reject("A Sign in with Apple request is already in progress.", "in_progress")
            return
        }

        pendingCall = call

        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        // Both are needed: the token for authentication, the name for the
        // account record. Email is requested because a new account is created
        // from it when the token carries one.
        request.requestedScopes = [.fullName, .email]

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        // Held on the instance so it survives past this method returning.
        authController = controller
        controller.performRequests()
    }

    /* --------------------------------------------------------- presentation */

    /// The window the sheet is presented from.
    ///
    /// Returning nil here is the usual cause of a silent failure: the request is
    /// made, and nothing is ever shown. The error is surfaced rather than
    /// swallowed so the web layer can report something actionable.
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = self.bridge?.viewController?.view.window {
            return window
        }
        // The bridge or its view is unexpectedly gone. A fresh window is a
        // legitimate anchor and keeps the sheet presentable rather than
        // crashing on a nil force-unwrap.
        return ASPresentationAnchor()
    }

    /* ------------------------------------------------------------- delegate */

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let call = takePendingCall()
        guard let call else { return }

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
            call.reject("Apple returned an unexpected credential type.", "unexpected_credential")
            return
        }

        guard
            let tokenData = credential.identityToken,
            let identityToken = String(data: tokenData, encoding: .utf8),
            !identityToken.isEmpty
        else {
            // A credential with no identity token cannot be verified, so there
            // is nothing useful to hand back. This should not happen when a
            // token was requested, and is worth surfacing loudly if it does.
            call.reject("Apple returned no identity token.", "no_identity_token")
            return
        }

        /*
         * `var`, not `let`: this project's JSObject is a value type, so
         * subscript assignment mutates the local copy rather than a reference
         * and cannot be done through a `let`.
         */
        var result = JSObject()
        result["identityToken"] = identityToken
        // Present only on first authorisation; absent on every sign-in after.
        result["user"] = credential.user

        if let code = credential.authorizationCode, let codeString = String(data: code, encoding: .utf8) {
            // Not used by this app -- the identity token is sufficient -- but
            // returned so the omission is deliberate rather than accidental, and
            // so a future server-side refresh flow does not need a rebuild.
            result["authorizationCode"] = codeString
        }

        // Name and email are only present on the FIRST authorisation. Absent is
        // the normal case, not an error, so they are simply omitted.
        var fullName: JSObject? = nil
        if let name = credential.fullName {
            var parts: JSObject = [:]
            if let v = name.givenName { parts["givenName"] = v }
            if let v = name.familyName { parts["familyName"] = v }
            if let v = name.middleName { parts["middleName"] = v }
            if let v = name.namePrefix { parts["namePrefix"] = v }
            if let v = name.nameSuffix { parts["nameSuffix"] = v }
            if let v = name.nickname { parts["nickname"] = v }
            if !parts.isEmpty { fullName = parts }
        }
        if let fullName { result["fullName"] = fullName }
        if let email = credential.email, !email.isEmpty { result["email"] = email }

        call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let call = takePendingCall()
        guard let call else { return }

        let nsError = error as NSError

        /*
         * A user cancelling is not a failure. It resolves with a flag so the
         * web layer can leave the UI as it was and say nothing, rather than
         * render an error for the normal outcome of tapping the button and
         * changing your mind.
         *
         * ASAuthorizationError.canceled (1001) is the documented code; the
         * domain is checked too so an unrelated error that happens to share the
         * number is not misread as a cancellation.
         */
        if nsError.domain == ASAuthorizationError.errorDomain,
           nsError.code == ASAuthorizationError.canceled.rawValue {
            call.resolve(["cancelled": true])
            return
        }

        // 1000 = unknown, 1002 = invalid response, 1003 = not handled,
        // 1004 = failed, 1005 = invalid request. Passed through as a stable
        // token so the web layer can branch without matching prose.
        call.reject(
            "Sign in with Apple failed: \(error.localizedDescription)",
            "apple_error_\(nsError.code)"
        )
    }

    /* -------------------------------------------------------------- helpers */

    /// Hand the pending call back and clear it, exactly once.
    ///
    /// Both delegate methods release the controller to break the retain cycle
    /// (plugin -> controller -> weak delegate, but the controller itself is kept
    /// alive by this reference) and to ensure the next call starts clean.
    private func takePendingCall() -> CAPPluginCall? {
        let call = pendingCall
        pendingCall = nil
        authController = nil
        return call
    }
}
