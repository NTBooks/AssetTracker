import { WorkOS } from '@workos-inc/node';

export function registerWorkosRoutes(app) {
    // Initialize WorkOS
    app.workos = new WorkOS(process.env.WORKOS_API_KEY, {
        clientId: process.env.WORKOS_CLIENT_ID,
    });

    app.get('/healthcheck', (req, res) => {
        return res.json({ status: "ok" });
    });

    app.get('/checklogin', async (req, res) => {
        try {
            const session = app.workos.userManagement.loadSealedSession({
                sessionData: req.cookies['wos-session'],
                cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
            });

            const { authenticated, user } = await session.authenticate();

            if (!authenticated || !user || !user.email) {
                return res.json({
                    status: "error",
                    message: "Not authenticated",
                    authenticated: false,
                    isAdmin: false
                });
            }

            const email = user.email.toLowerCase().trim();
            const adminEmails = String(process.env.ADMIN_EMAILS || '')
                .toLowerCase()
                .split(',')
                .map(e => e.trim())
                .filter(Boolean);
            const isAdmin = adminEmails.includes(email);

            return res.json({
                status: "success",
                message: "Authenticated",
                authenticated: true,
                isAdmin,
                user: {
                    email: user.email
                }
            });
        } catch (error) {
            console.error('Error in checklogin:', error);
            return res.json({
                status: "error",
                message: "Session error",
                authenticated: false,
                isAdmin: false
            });
        }
    });



    app.get('/login', (req, res) => {
        const authorizationUrl = app.workos.userManagement.getAuthorizationUrl({
            // Specify that we'd like AuthKit to handle the authentication flow
            provider: 'authkit',

            // The callback endpoint that WorkOS will redirect to after a user authenticates
            redirectUri: `${process.env.WORK_OS_HOST}/callback`,
            clientId: process.env.WORKOS_CLIENT_ID,
        });

        // Redirect the user to the AuthKit sign-in page
        res.redirect(authorizationUrl);
    });

    app.get('/logout', async (req, res) => {
        try {
            const session = app.workos.userManagement.loadSealedSession({
                sessionData: req.cookies['wos-session'],
                cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
            });

            const url = await session.getLogoutUrl({
                returnTo: `https://${req.hostname}/`
            });
            res.clearCookie('wos-session', cookieOptions(req));
            res.redirect(url);
        } catch (error) {
            console.error(error);
            res.clearCookie('wos-session', cookieOptions(req));
            res.redirect('/login');
        }
    });

    app.get('/callback', async (req, res) => {
        // The authorization code returned by AuthKit
        const code = req.query.code;

        if (!code) {
            console.error('No code provided in callback');
            return res.status(400).send('No code provided');
        }

        try {
            console.log('Processing callback with code:', code);
            const authenticateResponse =
                await app.workos.userManagement.authenticateWithCode({
                    clientId: process.env.WORKOS_CLIENT_ID,
                    code,
                    session: {
                        sealSession: true,
                        cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
                    },
                });

            const { user, sealedSession } = authenticateResponse;
            console.log('Authentication successful for user:', user.email);

            // Store the session in a cookie using the shared options
            res.cookie('wos-session', sealedSession, cookieOptions(req));

            // Redirect the user to the homepage
            return res.redirect('/');
        } catch (error) {
            console.error('Error in callback:', error);
            return res.redirect('/error');
        }
    });
}

function cookieOptions(req) {
    const isProd = process.env.NODE_ENV === 'production';
    const secure = isProd || (req.protocol === 'https');
    return {
        httpOnly: true,
        secure,
        sameSite: secure ? 'none' : 'lax',
        path: '/',
        // Optionally set domain when behind a custom domain
        // domain: process.env.COOKIE_DOMAIN || undefined,
        maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days
    };
}

export async function requireAdmin(req, res, next) {
    try {
        const workos = req.app?.workos;
        if (!workos) {
            return res.status(500).json({ status: 'error', message: 'Auth not initialized' });
        }
        const session = workos.userManagement.loadSealedSession({
            sessionData: req.cookies['wos-session'],
            cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
        });
        const { authenticated, user } = await session.authenticate();
        if (!authenticated || !user || !user.email) {
            return res.status(401).json({ status: 'error', message: 'Not authenticated' });
        }
        const email = user.email.toLowerCase().trim();
        const adminEmails = String(process.env.ADMIN_EMAILS || '')
            .toLowerCase()
            .split(',')
            .map(e => e.trim())
            .filter(Boolean);
        const isAdmin = adminEmails.includes(email);
        if (!isAdmin) {
            return res.status(403).json({ status: 'error', message: 'User not authorized' });
        }
        req.user = { email: user.email };
        req.isAdmin = true;
        return next();
    } catch (err) {
        console.error('requireAdmin error:', err);
        return res.status(500).json({ status: 'error', message: 'Auth error' });
    }
}

export async function getUserFromRequest(req) {
    try {
        const workos = req.app?.workos;
        if (!workos) return null;
        const session = workos.userManagement.loadSealedSession({
            sessionData: req.cookies['wos-session'],
            cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
        });
        const { authenticated, user } = await session.authenticate();
        if (!authenticated || !user || !user.email) return null;
        return { email: user.email };
    } catch {
        return null;
    }
}