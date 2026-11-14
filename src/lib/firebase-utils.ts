import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot,
  collectionGroup,
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import { db, auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helper generic functions

export async function getDocument<T>(collectionPath: string, id: string): Promise<T | null> {
  try {
    const docRef = doc(db, collectionPath, id);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() as T : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `${collectionPath}/${id}`);
    return null;
  }
}

export async function listDocuments<T>(collectionPath: string, constraints: QueryConstraint[] = []): Promise<T[]> {
  try {
    const q = query(collection(db, collectionPath), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ ...doc.data() as T, id: doc.id }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionPath);
    return [];
  }
}

export async function setDocument<T extends DocumentData>(collectionPath: string, id: string, data: T) {
  try {
    const docRef = doc(db, collectionPath, id);
    await setDoc(docRef, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${collectionPath}/${id}`);
  }
}

export async function updateDocument<T extends DocumentData>(collectionPath: string, id: string, data: Partial<T>) {
  try {
    const docRef = doc(db, collectionPath, id);
    await updateDoc(docRef, data as any);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${collectionPath}/${id}`);
  }
}

export async function removeDocument(collectionPath: string, id: string) {
  try {
    const docRef = doc(db, collectionPath, id);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionPath}/${id}`);
  }
}
