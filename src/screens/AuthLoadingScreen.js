import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import supabase, { handleSessionExpiry } from '../lib/supabase';

const AuthLoadingScreen = ({ navigation }) => {
  useEffect(() => {
    console.log('🔵 ===== AuthLoadingScreen STARTED =====');
    console.log('🔵 Current timestamp:', new Date().toISOString());
    
    const checkAuthAndOnboarding = async () => {
      try {
        // Check cached onboarded value first for debugging
        const initialCachedOnboarded = await AsyncStorage.getItem('onboarded');
        console.log('🔵 Initial cached onboarded value:', initialCachedOnboarded);
        
        // Add timeout for network issues (especially with Expo tunnel)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Session check timeout')), 10000); // 10 second timeout
        });

        // 1. Check Supabase auth with "Remember Me" functionality
        console.log('🔵 Step 1: Checking session...');
        const sessionPromise = handleSessionExpiry();
        let session;
        
        try {
          session = await Promise.race([sessionPromise, timeoutPromise]);
        } catch (timeoutError) {
          console.log('⚠️ Session check timed out, trying direct getSession()...');
          // On timeout, try to get session directly (Supabase reads from AsyncStorage automatically)
          try {
            const { data: { session: directSession }, error: directError } = await supabase.auth.getSession();
            if (directSession && !directError) {
              console.log('✅ Got session directly from Supabase storage');
              session = directSession;
            } else {
              console.log('⚠️ Direct session check also failed, checking onboarding cache...');
              // If we can't get session, check if user was previously onboarded
              // This allows app to continue even with network issues
              const cachedOnboarded = await AsyncStorage.getItem('onboarded');
              if (cachedOnboarded === 'true') {
                // User was onboarded before, assume they're still logged in
                // Try one more time with a shorter timeout
                try {
                  const quickSession = await Promise.race([
                    supabase.auth.getSession(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Quick timeout')), 2000))
                  ]);
                  if (quickSession?.data?.session) {
                    session = quickSession.data.session;
                    console.log('✅ Got session on quick retry');
                  }
                } catch (quickError) {
                  console.log('⚠️ Quick retry also failed, will check onboarding status');
                }
              }
            }
          } catch (directError) {
            console.error('Error in direct session check:', directError);
          }
        }

        if (!session || !session.user) {
          console.log('❌ No valid session found, navigating to Welcome screen');
          // Use reset to clear navigation stack completely
          navigation.reset({
            index: 0,
            routes: [{ name: 'Welcome' }],
          });
          return;
        }

        console.log('✅ Valid session found for user:', session.user.email);
        console.log('🔵 User ID:', session.user.id);
        
        // 2. Check onboarding status by checking if profile has essential fields
        // No need for separate onboarded column - we can infer from profile data
        let onboarded = true; // Default to true - assume user is onboarded unless proven otherwise
        console.log('🔵 Step 2: Checking onboarding status...');
        
        // IMPORTANT: If user has a valid session, they've likely completed onboarding
        // Only set onboarded=false if we're CERTAIN the profile doesn't exist
        let profile, profileError;
        let profileCheckAttempted = false;
        
        try {
          // Check profile directly from database (most reliable source of truth)
          // Add timeout for profile check as well, but with retry logic
          const profilePromise = supabase
            .from('user_profile')
            .select('name, age, gender, height, weight, calorie_goal')
            .eq('id', session.user.id)
            .single();
          
          const profileTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Profile check timeout')), 8000); // 8 second timeout (longer for cold start)
          });

          try {
            profileCheckAttempted = true;
            const result = await Promise.race([profilePromise, profileTimeout]);
            profile = result.data;
            profileError = result.error;
            console.log('🔵 Profile check result:', profile ? 'Profile found' : 'No profile', profileError ? `Error: ${profileError.code}` : '');
          } catch (timeoutError) {
            console.log('⚠️ Profile check timed out, will retry once...');
            profileError = { code: 'TIMEOUT', message: 'Profile check timeout' };
            
            // Retry once with shorter timeout (might be slow network on cold start)
            try {
              console.log('🔵 Retrying profile check...');
              const retryResult = await Promise.race([
                supabase
                  .from('user_profile')
                  .select('name, age, gender, height, weight, calorie_goal')
                  .eq('id', session.user.id)
                  .single(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Retry timeout')), 5000))
              ]);
              profile = retryResult.data;
              profileError = retryResult.error;
              console.log('🔵 Retry result:', profile ? 'Profile found on retry' : 'Still no profile');
            } catch (retryError) {
              console.log('⚠️ Profile check retry also timed out');
              profileError = { code: 'TIMEOUT', message: 'Profile check timeout (retry failed)' };
            }
          }
          
          if (profileError) {
            console.error('Error fetching profile:', profileError);
            // If profile doesn't exist (PGRST116 = not found), user is not onboarded
            if (profileError.code === 'PGRST116' || profileError.message?.includes('No rows')) {
              // Only set onboarded=false if we're CERTAIN the profile doesn't exist
              onboarded = false;
              await AsyncStorage.setItem('onboarded', 'false');
              console.log('❌ Profile not found - user needs onboarding');
            } else if (profileError.code === 'TIMEOUT') {
              // On timeout: If user has valid session, they're likely onboarded
              // Only go to Profile if explicitly cached as false
              const cachedOnboarded = await AsyncStorage.getItem('onboarded');
              console.log('🔵 Profile timeout - cached onboarded:', cachedOnboarded);
              
              if (cachedOnboarded === 'false') {
                // Only if explicitly cached as false AND we couldn't verify profile
                // But wait - if user has session, they might have completed onboarding
                // Let's check one more time with a simpler query
                try {
                  const quickCheck = await Promise.race([
                    supabase.from('user_profile').select('id').eq('id', session.user.id).maybeSingle(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Quick check timeout')), 3000))
                  ]);
                  
                  if (quickCheck.data) {
                    // Profile exists! User is onboarded
                    onboarded = true;
                    await AsyncStorage.setItem('onboarded', 'true');
                    console.log('✅ Quick check found profile - user is onboarded');
                  } else {
                    // Profile really doesn't exist
                    onboarded = false;
                    console.log('❌ Quick check confirmed no profile - user needs onboarding');
                  }
                } catch (quickError) {
                  // Quick check also failed - default to MainDashboard if we have session
                  // Having a session means user has used the app before
                  onboarded = true;
                  console.log('⚠️ Quick check failed, but user has session - defaulting to onboarded=true');
                }
              } else {
                // No cached value or cached says true - default to true for logged-in users
                onboarded = true;
                console.log('⚠️ Profile check timeout, defaulting to onboarded=true (user has session)');
              }
            } else {
              // On other errors (network, etc.)
              // If user has session, they're likely onboarded - only go to Profile if CERTAIN
              const cachedOnboarded = await AsyncStorage.getItem('onboarded');
              console.log('🔵 Profile error - cached onboarded:', cachedOnboarded);
              
              if (cachedOnboarded === 'false') {
                // Try one more simple check before going to Profile
                try {
                  const simpleCheck = await supabase
                    .from('user_profile')
                    .select('id')
                    .eq('id', session.user.id)
                    .maybeSingle();
                  
                  if (simpleCheck.data) {
                    onboarded = true;
                    await AsyncStorage.setItem('onboarded', 'true');
                    console.log('✅ Simple check found profile - user is onboarded');
                  } else {
                    onboarded = false;
                    console.log('❌ Simple check confirmed no profile');
                  }
                } catch (simpleError) {
                  // Default to MainDashboard - user has session so they've used app before
                  onboarded = true;
                  console.log('⚠️ Simple check failed, defaulting to onboarded=true (user has session)');
                }
              } else {
                // Default to true for logged-in users (safer - assume they've completed onboarding)
                onboarded = true;
                console.log('⚠️ Profile fetch error, defaulting to onboarded=true (user has session)');
              }
            }
          } else if (profile) {
            // Check if essential onboarding fields are present
            // User is considered onboarded if they have name, age, gender, height, weight, and calorie_goal
            const hasEssentialFields = 
              profile.name && 
              profile.age && 
              profile.gender && 
              profile.height && 
              profile.weight && 
              profile.calorie_goal;
            
            onboarded = !!hasEssentialFields;
            
            // Update AsyncStorage to match database state
            await AsyncStorage.setItem('onboarded', onboarded ? 'true' : 'false');
            console.log(`✅ Profile found - onboarded: ${onboarded}`);
          } else {
            // No profile found in result (shouldn't happen, but handle it)
            // Check cache first before assuming not onboarded
            const cachedOnboarded = await AsyncStorage.getItem('onboarded');
            if (cachedOnboarded === 'false') {
              onboarded = false;
            } else {
              // Default to true - might be a data parsing issue
              onboarded = true;
              console.log('⚠️ No profile in result, defaulting to onboarded=true');
            }
          }
        } catch (error) {
          console.error('Error checking onboarding status:', error);
          // On any error, check cached status first
          try {
            const cachedOnboarded = await AsyncStorage.getItem('onboarded');
            if (cachedOnboarded === 'false') {
              onboarded = false;
              console.log('⚠️ Error checking onboarding, using cached onboarded=false');
            } else {
              // Default to true for logged-in users (safer - assume they've completed onboarding)
              onboarded = true;
              console.log('⚠️ Error checking onboarding, defaulting to onboarded=true for logged-in user');
            }
          } catch (cacheError) {
            // If we can't even read cache, default to true
            onboarded = true;
            console.log('⚠️ Error reading cache, defaulting to onboarded=true');
          }
        }
        
        // For logged-in users: Always go to MainDashboard unless we're CERTAIN they haven't onboarded
        // Only go to Profile if we confirmed the profile doesn't exist (PGRST116) or cached says false
        // Use reset() to clear navigation stack and prevent back navigation to AuthLoading
        
        // Final check: If cached says false but we have a valid session, clear it and go to MainDashboard
        // This fixes the case where cached value is incorrectly set
        const finalCachedOnboarded = await AsyncStorage.getItem('onboarded');
        console.log(`🔵 Final cached onboarded value: ${finalCachedOnboarded}`);
        console.log(`🔵 Calculated onboarded value: ${onboarded}`);
        
        if (finalCachedOnboarded === 'false' && onboarded === true) {
          console.log('⚠️ Cached value is false but calculated is true - clearing cache and going to MainDashboard');
          await AsyncStorage.removeItem('onboarded');
        }
        
        // CRITICAL FIX: If cached says false but we have a valid session, 
        // the user has clearly used the app before and is onboarded
        // This handles the case where app was closed/removed from recents and cache got cleared
        if (finalCachedOnboarded === 'false' && session && session.user && profileCheckAttempted) {
          // Only force if we attempted to check profile (to avoid overriding legitimate "not onboarded" state)
          // If user has session, they've logged in before, so they're likely onboarded
          console.log('🔧 FIX: Cached onboarded=false but user has valid session - checking profile one more time...');
          
          // Final attempt: simple profile existence check
          try {
            const finalCheck = await Promise.race([
              supabase.from('user_profile').select('id').eq('id', session.user.id).maybeSingle(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Final check timeout')), 3000))
            ]);
            
            if (finalCheck.data) {
              console.log('✅ Final check: Profile exists - user IS onboarded, forcing MainDashboard');
              onboarded = true;
              await AsyncStorage.setItem('onboarded', 'true');
            } else {
              console.log('❌ Final check: No profile found - user needs onboarding');
              // Keep onboarded = false if profile really doesn't exist
            }
          } catch (finalError) {
            // If final check fails, but user has session, assume onboarded
            console.log('⚠️ Final check failed, but user has session - assuming onboarded');
            onboarded = true;
            await AsyncStorage.setItem('onboarded', 'true');
          }
        }
        
        const targetScreen = onboarded ? 'MainDashboard' : 'Profile';
        console.log(`🚀 ===== NAVIGATION DECISION =====`);
        console.log(`🚀 onboarded: ${onboarded}`);
        console.log(`🚀 targetScreen: ${targetScreen}`);
        console.log(`🚀 Navigating to: ${targetScreen}`);
        
        if (onboarded) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'MainDashboard' }],
          });
          console.log('✅ Navigation reset to MainDashboard completed');
        } else {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Profile' }], // First onboarding screen
          });
          console.log('✅ Navigation reset to Profile completed');
        }
        
        // Log after a short delay to see what screen we're actually on
        setTimeout(() => {
          console.log('🔵 ===== POST-NAVIGATION CHECK =====');
          console.log('🔵 Navigation state should be:', targetScreen);
        }, 500);
      } catch (error) {
        console.error('Error in AuthLoadingScreen:', error);
        // On critical error, default to MainDashboard with reset to clear stack
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainDashboard' }],
        });
      }
    };
    checkAuthAndOnboarding();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <ActivityIndicator size="large" color="#7B61FF" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
});

export default AuthLoadingScreen; 