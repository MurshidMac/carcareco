import 'server-only'
import { cookies } from 'next/headers' 
import { JWTPayload, SignJWT, jwtVerify } from 'jose' 

const secretKey = process.env.SESSION_SECRET
const sessionTimeoutInSecondsString = process.env.NEXT_PUBLIC_SESSION_TIMEOUT;
 
if(!secretKey) throw new Error('SESSION_SECRET env not set');

const encodedKey = new TextEncoder().encode(secretKey)

interface SessionPayload extends JWTPayload{
  apiRootJwt:string
}

 async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encodedKey)
}
 
 async function decrypt(session: string | undefined = '') {
  if (!session) return null
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}
export async function createSession(rootJwt: string,publicJwt: string) {
    
  if(!sessionTimeoutInSecondsString) throw new Error('NEXT_PUBLIC_SESSION_TIMEOUT env not set');
 
  const expiresAt = new Date(Date.now());   
  expiresAt.setSeconds(expiresAt.getSeconds() + parseInt(sessionTimeoutInSecondsString)); 
  const session = await encrypt({ apiRootJwt:rootJwt, expiresAt })
  const cookieStore = await cookies() 
  cookieStore.set('session', session, {
    httpOnly: true, //jwt not accessible by browser
    secure: false,
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  })
  //jwt for public side resources
  cookieStore.set('jwt',  publicJwt, {
    httpOnly: false,
    secure: false,
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  })
   //browser app has to know when session started so it can call extend session before api jwt times out
  cookieStore.set('session_timestamp',  Date.now().toString(), {
    httpOnly: false,
    secure: false,
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  })
}
export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete('session')
  cookieStore.delete('jwt')
  cookieStore.delete('session_timestamp')
}
export async function getJwt() { 
  const cookieStore = await cookies()
  const session = cookieStore.get('session')?.value;
  const payload = await decrypt(session)
 
  if (!session || !payload?.apiRootJwt) {
    if (session) {
      cookieStore.delete('session')
      cookieStore.delete('jwt')
      cookieStore.delete('session_timestamp')
    }
    return null
  }
  return payload.apiRootJwt;
}
