import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

// Load env variables from .env.local
const envPath = path.resolve('.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local file not found!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    env[key] = val;
  }
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

console.log('Connecting to Firebase project:', firebaseConfig.projectId);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanSetup() {
  try {
    console.log('Fetching all polls...');
    const pollsSnap = await getDocs(collection(db, 'polls'));
    console.log(`Found ${pollsSnap.size} polls.`);

    for (const pollDoc of pollsSnap.docs) {
      const pollId = pollDoc.id;
      console.log(`Deleting poll ${pollId} (${pollDoc.data().title || 'Untitled'})...`);

      // Get subcollections
      const subcollections = ['questions', 'participants', 'responses', 'leaderboard'];
      const batch = writeBatch(db);

      for (const sub of subcollections) {
        const subSnap = await getDocs(collection(db, 'polls', pollId, sub));
        subSnap.docs.forEach((d) => {
          batch.delete(d.ref);
        });
      }

      batch.delete(pollDoc.ref);
      await batch.commit();
      console.log(`Deleted poll ${pollId} and all its nested subcollections.`);
    }

    console.log('\n======================================');
    console.log('Database cleanup completed successfully!');
    console.log('All poll data has been removed.');
    console.log('======================================');
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  }
}

cleanSetup();
