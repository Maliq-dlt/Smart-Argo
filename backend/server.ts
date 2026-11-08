import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware parsing JSON
app.use(express.json());

// API Health Check Dasar
app.get('/health', (req: Request, res: Response) => {
    res.json({
        success: true,
        message: "Server Backend Smart Agro berjalan dengan baik!",
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Server Backend berjalan di http://localhost:${PORT}`);
});
