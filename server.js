const express = require('express');
const session = require('express-session');
const path = require('path');
const NodeCache = require('node-cache');
const { runAsync, allAsync, getAsync } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const cache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

app.use(session({
    secret: 'atominform-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function requireAdmin(req, res, next) {
    if (req.session.isAdmin) return next();
    res.redirect('/admin/login');
}

app.get('/', async (req, res) => {
    const success = req.query.success;
    res.render('index', { success, currentPage: 'home' });
});

app.post('/api/submit', async (req, res) => {
    try {
        const { fullName, email, subject, priority, phone } = req.body;
        if (!fullName || !email || !subject || !priority || !phone) {
            return res.status(400).render('services', {
                error: { field: 'form', message: 'Все поля обязательны' },
                currentPage: 'services',
                success: false
            });
        }

        const phoneDigits = phone.replace(/\D/g, '');
        if (phoneDigits.length < 10 || phoneDigits.length > 12) {
            return res.status(400).render('services', {
                error: { field: 'phone', message: 'Телефон должен содержать 10-12 цифр' },
                currentPage: 'services',
                success: false
            });
        }

        // Проверка email
        const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).render('services', {
                error: { field: 'email', message: 'Введите корректный email (например, name@example.com)' },
                currentPage: 'services',
                success: false
            });
        }

        await runAsync(
            `INSERT INTO submissions (fullName, email, subject, priority, phone) VALUES (?, ?, ?, ?, ?)`,
            [fullName, email, subject, priority, phoneDigits]
        );
        cache.del('allSubmissions');
        res.render('services', {
            currentPage: 'services',
            success: true
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/admin/login', (req, res) => {
    res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await getAsync(
            `SELECT * FROM users WHERE username = ? AND password = ?`,
            [username, password]
        );
        if (user) {
            req.session.isAdmin = true;
            res.redirect('/admin');
        } else {
            res.render('admin-login', { error: 'Неверные учётные данные' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.post('/admin/status/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        await runAsync(`UPDATE submissions SET status = ? WHERE id = ?`, [status, id]);
        cache.del('allSubmissions');
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        const filter = req.query.filter || 'all';
        let submissions;

        if (search) {
            submissions = await allAsync(
                `SELECT * FROM submissions
                 WHERE (fullName LIKE ? OR email LIKE ? OR phone LIKE ?)
                 ORDER BY created_at DESC`,
                [`%${search}%`, `%${search}%`, `%${search}%`]
            );
        } else {
            if (filter === 'new') {
                submissions = await allAsync(`SELECT * FROM submissions WHERE status = 'new' ORDER BY created_at DESC`);
            } else if (filter === 'processed') {
                submissions = await allAsync(`SELECT * FROM submissions WHERE status = 'processed' ORDER BY created_at DESC`);
            } else {
                submissions = cache.get('allSubmissions');
                if (!submissions) {
                    submissions = await allAsync(`SELECT * FROM submissions ORDER BY created_at DESC`);
                    cache.set('allSubmissions', submissions);
                }
            }
        }

        const allSubmissions = await allAsync(`SELECT * FROM submissions`);
        const total = allSubmissions.length;
        const newCount = allSubmissions.filter(s => s.status === 'new').length;
        const processedCount = allSubmissions.filter(s => s.status === 'processed').length;

        res.render('admin', {
            submissions,
            searchQuery: search,
            total: total,
            newCount: newCount,
            processedCount: processedCount
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/reviews', async (req, res) => {
    try {
        const selectedTag = req.query.tag || 'all';
        const allReviews = await allAsync(`SELECT * FROM reviews ORDER BY created_at DESC`);
        const avgRow = await getAsync(`SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews`);
        const average = avgRow && avgRow.avg ? parseFloat(avgRow.avg.toFixed(1)) : 0;
        const count = avgRow ? avgRow.cnt : 0;

        const tagsList = ['все', 'быстро', 'удобно', 'качественно', 'современно', 'полезно', 'понятно'];

        let reviews = allReviews;
        if (selectedTag && selectedTag !== 'all' && selectedTag !== 'все') {
            reviews = allReviews.filter(r => {
                if (!r.tags) return false;
                const parts = r.tags.split(',').map(s => s.trim().toLowerCase());
                return parts.includes(selectedTag.toLowerCase());
            });
        }

        res.render('reviews', { reviews, average, count, tagsList, selectedTag, currentPage: 'reviews' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.post('/reviews', async (req, res) => {
    try {
        const { name, rating, text } = req.body;
        let tags = req.body.tags || [];
        if (!Array.isArray(tags)) tags = [tags];
        const tagsStr = tags.map(t => t.trim()).filter(Boolean).join(',');

        if (!name || !rating || !text) {
            const allReviews = await allAsync(`SELECT * FROM reviews ORDER BY created_at DESC`);
            const avgRow = await getAsync(`SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews`);
            const average = avgRow && avgRow.avg ? parseFloat(avgRow.avg.toFixed(1)) : 0;
            const count = avgRow ? avgRow.cnt : 0;
            return res.status(400).render('reviews', {
                reviews: allReviews,
                average,
                count,
                tagsList: ['все', 'быстро', 'удобно', 'качественно', 'современно', 'полезно', 'понятно'],
                selectedTag: 'all',
                error: { field: 'form', message: 'Имя, оценка и текст обязательны' },
                currentPage: 'reviews'
            });
        }

        await runAsync(`INSERT INTO reviews (name, rating, text, tags) VALUES (?, ?, ?, ?)`,
            [name, rating, text || '', tagsStr]);
        res.redirect('/reviews');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.get('/services', (req, res) => {
    res.render('services', {
        currentPage: 'services',
        success: false
    });
});

app.get('/contacts', (req, res) => {
    res.render('contacts', { currentPage: 'contacts' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});